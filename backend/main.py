"""
MediVoice AI 2.0 — Gemini clinical orchestrator (lean FastAPI, no local ML).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel, Field

_ROOT = Path(__file__).resolve().parent
_REPO = _ROOT.parent
# Repo-root `.env` (same as your existing project) + optional `backend/.env`
load_dotenv(_REPO / ".env")
load_dotenv(_ROOT / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medivoice")

DATA_DIR = _ROOT / "data"
HISTORY_PATH = DATA_DIR / "triage_history.jsonl"
GEMINI_MODEL = os.getenv("GEMINI_MODEL") or os.getenv("GEMINI_TRIAGE_MODEL") or "gemini-1.5-flash"

app = FastAPI(title="MediVoice AI 2.0", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TriageIn(BaseModel):
    voice_transcript: str = Field(..., min_length=1)
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None


class TriageOut(BaseModel):
    event_id: str
    risk_score: float
    priority: Literal["P1", "P2", "P3"]
    clinical_rationale: str
    next_steps: str
    source: str


class ExportIn(BaseModel):
    """Build FHIR RiskAssessment from triage fields (or pass raw triage JSON)."""

    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    risk_score: float
    priority: str
    clinical_rationale: str
    occurrence_datetime: Optional[str] = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append_audit(record: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, default=str) + "\n"
    with open(HISTORY_PATH, "a", encoding="utf-8") as f:
        f.write(line)


def _rule_fallback(transcript: str) -> dict[str, Any]:
    t = transcript.lower()
    score = 35.0
    if any(x in t for x in ("chest pain", "can't breathe", "difficulty breathing", "severe")):
        score = 82.0
    elif any(x in t for x in ("pain", "fever", "worse")):
        score = 58.0
    if "routine" in t or "fine" in t:
        score = max(15.0, score - 20.0)
    score = max(0.0, min(100.0, score))
    pr: Literal["P1", "P2", "P3"] = "P1" if score >= 75 else "P2" if score >= 45 else "P3"
    return {
        "risk_score": round(score, 1),
        "priority": pr,
        "clinical_rationale": "Rule-based fallback (no Gemini key or API error). Not a diagnosis.",
        "next_steps": "Nurse callback within 15 minutes if P1; otherwise standard scheduling per policy.",
        "source": "rules",
    }


def _run_gemini_sync(transcript: str) -> dict[str, Any]:
    import google.generativeai as genai

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        logger.warning("No GEMINI_API_KEY — using rule fallback")
        return _rule_fallback(transcript)

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        GEMINI_MODEL,
        system_instruction=(
            "You are a senior triage nurse assistant for a hospital scheduling demo. "
            "You do NOT diagnose. Respond with JSON ONLY, no markdown, keys: "
            "risk_score (0-100 number), priority (string P1, P2, or P3), "
            "clinical_rationale (short string), next_steps (short string for the care team)."
        ),
    )
    prompt = f'Voice / intake transcript:\n"""{transcript.strip()}"""\nReturn JSON only.'
    try:
        resp = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(temperature=0.2),
        )
        raw = (resp.text or "").strip()
        if not raw:
            raise RuntimeError("Empty Gemini response")
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        data = json.loads(raw)
        rs = float(data.get("risk_score", 50))
        rs = max(0.0, min(100.0, rs))
        p = str(data.get("priority", "P3")).upper()
        if p not in ("P1", "P2", "P3"):
            p = "P3"
        return {
            "risk_score": round(rs, 1),
            "priority": p,
            "clinical_rationale": str(data.get("clinical_rationale", ""))[:2000],
            "next_steps": str(data.get("next_steps", ""))[:2000],
            "source": "gemini",
        }
    except Exception as e:
        logger.warning("Gemini failed: %s — fallback", e)
        return _rule_fallback(transcript)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "medivoice-2", "gemini_model": GEMINI_MODEL}


@app.post("/triage", response_model=TriageOut)
async def triage(body: TriageIn):
    event_id = str(uuid.uuid4())
    raw = await asyncio.to_thread(_run_gemini_sync, body.voice_transcript)

    out = TriageOut(
        event_id=event_id,
        risk_score=raw["risk_score"],
        priority=raw["priority"],
        clinical_rationale=raw["clinical_rationale"],
        next_steps=raw["next_steps"],
        source=raw["source"],
    )

    _append_audit(
        {
            "ts": _utc_now(),
            "event_id": event_id,
            "patient_id": body.patient_id,
            "patient_name": body.patient_name,
            "risk_score": out.risk_score,
            "priority": out.priority,
            "source": out.source,
            "transcript_excerpt": body.voice_transcript[:500],
        }
    )
    return out


@app.post("/export")
async def export_fhir(body: ExportIn) -> dict[str, Any]:
    """Minimal valid FHIR R4 RiskAssessment for interoperability demos."""
    rid = str(uuid.uuid4())[:8]
    pid = body.patient_id or "demo-patient"
    occurred = body.occurrence_datetime or _utc_now()
    score = max(0.0, min(100.0, float(body.risk_score)))

    resource: dict[str, Any] = {
        "resourceType": "RiskAssessment",
        "id": f"ra-{rid}",
        "meta": {"profile": ["http://hl7.org/fhir/StructureDefinition/RiskAssessment"]},
        "status": "final",
        "subject": {"reference": f"Patient/{pid}", "display": body.patient_name or "Patient"},
        "occurrenceDateTime": occurred,
        "prediction": [
            {
                "outcome": {
                    "text": f"Triage priority {body.priority} — {body.clinical_rationale[:280]}"
                },
                "relativeRisk": score / 100.0,
                "qualitativeRisk": {"text": f"Score {score:.0f}/100"},
            }
        ],
    }
    return resource


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
