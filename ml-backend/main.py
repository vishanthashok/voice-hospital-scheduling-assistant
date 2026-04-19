"""
MediVoice 2.0 — Gemini Clinical Orchestrator (Hook'em Hacks patient-centered flow).

FastAPI only; no local sklearn/SHAP. Triage reasoning runs in Gemini (google-genai SDK).
Render: uvicorn main:app --host 0.0.0.0 --port $PORT
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.dirname(__file__))
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env")

from data.seed_patients import SEED_PATIENTS
from data.synthetic_scheduler import generate_synthetic_patients
from models.slot_recommender import score_slots

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medivoice-gemini")

DATA_DIR = Path(__file__).resolve().parent / "data"
TRIAGE_JSONL = DATA_DIR / "triage_records.jsonl"

GEMINI_MODEL = os.getenv("GEMINI_TRIAGE_MODEL", "gemini-1.5-flash")
# Prevent hung Gemini HTTP calls from blocking the UI forever (seconds).
# Keep slightly under the browser fetch timeout (~55s) so the server returns rule-fallback JSON first.
GEMINI_THREAD_TIMEOUT = float(os.getenv("GEMINI_THREAD_TIMEOUT", "48"))

# Demo / free-tier: only one Gemini triage runs at a time (others wait in FIFO order).
_TRIAGE_LOCK = asyncio.Lock()

ORCHESTRATOR_SYSTEM = """You are a Senior Triage Nurse for a hospital scheduling demo (Hook'em Hacks — patient-centered care).
You are NOT issuing a formal medical diagnosis. Analyze the voice transcript in clinical context and return JSON ONLY (no markdown).

The JSON object MUST have exactly these keys:
{
  "risk_score": <number 0-100>,
  "priority": "P1" | "P2" | "P3",
  "clinical_rationale": "<short explanation for the care team>",
  "top_drivers": [
    {"factor": "<string>", "weight": <number 0-1>, "direction": "increases_risk" | "decreases_risk", "note": "<few words>"}
  ],
  "fhir_risk_assessment": <object: valid FHIR R4 RiskAssessment JSON with resourceType, id, status, subject, occurrenceDateTime, prediction>
}
top_drivers MUST have exactly 3 items. fhir_risk_assessment MUST be a complete RiskAssessment resource."""

# ── CORS: allow all origins (hackathon / Render friendly) ───────────────────
app = FastAPI(
    title="MediVoice 2.0 — Gemini Clinical Orchestrator",
    version="2.0.0",
    description="Patient-centered triage via Gemini; JSONL audit trail.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("Gemini model=%s key=%s", GEMINI_MODEL, "set" if _api_key() else "missing")


def _api_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")


def _utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append_jsonl(path: Path, record: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, default=str) + "\n"
    with open(path, "a", encoding="utf-8") as f:
        f.write(line)


def _risk_band(score: float) -> str:
    if score >= 80:
        return "Critical"
    if score >= 60:
        return "High"
    if score >= 35:
        return "Moderate"
    return "Low"


def _p_to_hml(p: str) -> str:
    p = (p or "P3").strip().upper()
    if p == "P1":
        return "High"
    if p == "P2":
        return "Medium"
    return "Low"


def _rule_fallback(transcript: str, age: int, condition: str) -> Dict[str, Any]:
    t = (transcript or "").lower()
    base = 40 + min(30, age // 3)
    if any(x in t for x in ("chest pain", "can't breathe", "difficulty breathing", "severe", "worst")):
        base = min(95, base + 35)
    if any(x in t for x in ("asthma", "copd", "heart", "stroke")):
        base = min(92, base + 15)
    if "fine" in t or "routine" in t:
        base = max(15, base - 15)
    score = float(max(5, min(98, base)))
    pl = "P1" if score >= 75 else "P2" if score >= 45 else "P3"
    ra = {
        "resourceType": "RiskAssessment",
        "id": "rule-fallback-1",
        "status": "final",
        "subject": {"reference": "Patient/example"},
        "occurrenceDateTime": _utc_iso(),
        "prediction": [
            {
                "outcome": {"text": f"Rule-based triage score {score:.0f} — not a diagnosis"},
                "relativeRisk": score / 100.0,
            }
        ],
    }
    return {
        "risk_score": round(score, 1),
        "priority": pl,
        "clinical_rationale": f"Rule-based fallback (no Gemini). Condition context: {condition}.",
        "top_drivers": [
            {"factor": "chief_complaint_language", "weight": 0.5, "direction": "increases_risk", "note": "Keyword cues in transcript"},
            {"factor": "age", "weight": 0.25, "direction": "increases_risk", "note": str(age)},
            {"factor": "condition", "weight": 0.25, "direction": "increases_risk", "note": condition},
        ],
        "fhir_risk_assessment": ra,
        "source": "rules",
    }


def _parse_json_text(raw: str) -> Dict[str, Any]:
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(raw)


def run_gemini_orchestrator(
    *,
    voice_transcript: str,
    patient_id: Optional[str],
    patient_name: str,
    age: int,
    gender: str,
    condition: str,
) -> Dict[str, Any]:
    """Central orchestrator — transcript-first triage + FHIR RiskAssessment in one JSON response."""
    if os.getenv("MEDIVOICE_TRIAGE_RULES_ONLY", "").strip().lower() in ("1", "true", "yes"):
        logger.info("MEDIVOICE_TRIAGE_RULES_ONLY — skipping Gemini (instant demo)")
        return _rule_fallback(voice_transcript, age, condition)

    key = _api_key()
    if not key:
        logger.warning("No GEMINI_API_KEY — rule fallback")
        return _rule_fallback(voice_transcript, age, condition)

    from google import genai
    from google.genai import types as genai_types

    user = json.dumps(
        {
            "patient_id": patient_id,
            "patient_name": patient_name,
            "age": age,
            "gender": gender,
            "condition": condition,
            "voice_transcript": voice_transcript or "(empty — infer from demographics only)",
        },
        indent=2,
    )

    client = genai.Client(api_key=key)
    cfg = genai_types.GenerateContentConfig(
        system_instruction=ORCHESTRATOR_SYSTEM,
        temperature=0.2,
        response_mime_type="application/json",
    )
    try:
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=user, config=cfg)
        raw = (resp.text or "").strip()
        if not raw:
            raise RuntimeError("Empty Gemini response")
        data = _parse_json_text(raw)
        data["source"] = "gemini"
        rs = float(data.get("risk_score", 50))
        data["risk_score"] = max(0, min(100, rs))
        if data.get("priority") not in ("P1", "P2", "P3"):
            data["priority"] = "P3"
        if not isinstance(data.get("top_drivers"), list):
            data["top_drivers"] = []
        data["top_drivers"] = data["top_drivers"][:3]
        if not isinstance(data.get("fhir_risk_assessment"), dict):
            data["fhir_risk_assessment"] = _rule_fallback(voice_transcript, age, condition)["fhir_risk_assessment"]
        return data
    except Exception as e:
        logger.warning("Gemini orchestrator failed: %s — fallback", e)
        return _rule_fallback(voice_transcript, age, condition)


# ── Schemas (match frontend) ─────────────────────────────────────────────────

class TriageAnalyzeIn(BaseModel):
    patient_id: Optional[str] = None
    patient_name: str = "Unknown"
    age: int = Field(50, ge=0, le=120)
    gender: str = "U"
    condition: str = "Unknown"
    voice_transcript: str = ""
    session_id: Optional[str] = None


class TopDriver(BaseModel):
    factor: str
    weight: float
    direction: str
    note: str = ""


class TriageAnalyzeOut(BaseModel):
    risk_score: float
    risk_band: str
    priority_level: str  # P1 P2 P3
    priority_label: str  # High Medium Low
    clinical_rationale: str
    top_drivers: List[TopDriver]
    fhir_risk_assessment: Dict[str, Any]
    source: str


class PatientFeatures(BaseModel):
    age: int = 50
    gender: str = "M"
    condition: str = "Diabetes"
    urgency: int = 3
    days_since_visit: int = 30
    insurance: str = "Aetna"
    language: Optional[str] = "English"
    preferred_doctor: Optional[str] = None
    patient_id: Optional[str] = None
    session_id: Optional[str] = None
    voice_transcript: Optional[str] = None
    entry_source: Optional[str] = None


class SlotResponse(BaseModel):
    top_slots: List[Dict[str, Any]]
    patient_summary: Dict[str, Any]


# ── Routes ─────────────────────────────────────────────────────────────────


@app.get("/", tags=["Health"])
def root():
    return {"status": "ok", "service": "MediVoice 2.0 Gemini Orchestrator"}


@app.get("/health", tags=["Health"])
def health():
    return {
        "status": "healthy",
        "triage_backend": "gemini-orchestrator",
        "gemini_configured": bool(_api_key()),
        "gemini_model": GEMINI_MODEL,
    }


@app.post("/triage/analyze", response_model=TriageAnalyzeOut, tags=["Triage"])
async def triage_analyze(body: TriageAnalyzeIn):
    """Primary Hook'em flow: transcript → Gemini JSON (risk, P1–P3, drivers, FHIR RiskAssessment)."""
    async with _TRIAGE_LOCK:
        try:
            try:
                raw = await asyncio.wait_for(
                    asyncio.to_thread(
                        run_gemini_orchestrator,
                        voice_transcript=body.voice_transcript,
                        patient_id=body.patient_id,
                        patient_name=body.patient_name,
                        age=body.age,
                        gender=body.gender,
                        condition=body.condition,
                    ),
                    timeout=GEMINI_THREAD_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.warning("Gemini orchestrator timed out after %ss — rule fallback", GEMINI_THREAD_TIMEOUT)
                raw = _rule_fallback(body.voice_transcript, body.age, body.condition)
            score = float(raw["risk_score"])
            band = _risk_band(score)
            pl = str(raw.get("priority", "P3")).upper()
            if pl not in ("P1", "P2", "P3"):
                pl = "P3"
            drivers_in = raw.get("top_drivers") or []
            drivers: List[TopDriver] = []
            for i, row in enumerate(drivers_in[:3]):
                if isinstance(row, dict):
                    drivers.append(
                        TopDriver(
                            factor=str(row.get("factor", f"factor_{i}")),
                            weight=float(row.get("weight", 0.33)),
                            direction=str(row.get("direction", "increases_risk")),
                            note=str(row.get("note", "")),
                        )
                    )
            while len(drivers) < 3:
                drivers.append(TopDriver(factor="context", weight=0.2, direction="increases_risk", note="Placeholder"))

            out = TriageAnalyzeOut(
                risk_score=round(score, 1),
                risk_band=band,
                priority_level=pl,
                priority_label=_p_to_hml(pl),
                clinical_rationale=str(raw.get("clinical_rationale", "")),
                top_drivers=drivers[:3],
                fhir_risk_assessment=dict(raw.get("fhir_risk_assessment") or {}),
                source=str(raw.get("source", "rules")),
            )

            _append_jsonl(
                TRIAGE_JSONL,
                {
                    "ts": _utc_iso(),
                    "patient_id": body.patient_id,
                    "patient_name": body.patient_name,
                    "session_id": body.session_id,
                    "risk_score": out.risk_score,
                    "priority_level": out.priority_level,
                    "source": out.source,
                },
            )
            return out
        except Exception as e:
            logger.exception("triage_analyze")
            raise HTTPException(status_code=500, detail=str(e))


@app.get("/scheduler/synthetic-patients", tags=["Scheduler"])
async def list_synthetic_patients(limit: int = Query(120, ge=20, le=400)):
    pts = await asyncio.to_thread(generate_synthetic_patients, limit)
    return {"patients": pts, "count": len(pts)}


@app.get("/model/info", tags=["Model"])
def model_info():
    return {
        "mode": "gemini-clinical-orchestrator",
        "model": GEMINI_MODEL,
        "gemini_configured": bool(_api_key()),
    }


@app.post("/batch/seed", tags=["Batch"])
def batch_seed():
    """Dashboard demo — lightweight scores without Gemini spam."""
    results = []
    for p in SEED_PATIENTS:
        tr = _rule_fallback(p.get("callNotes") or "", p["age"], p["condition"])
        results.append(
            {
                "id": p["id"],
                "name": p["name"],
                "risk_score": tr["risk_score"],
                "risk_band": _risk_band(tr["risk_score"]),
                "priority": _p_to_hml(tr["priority"]),
                "confidence": 0.55,
            }
        )
    return {"results": results, "count": len(results)}


def _features_to_triage_dict(p: PatientFeatures) -> Dict[str, Any]:
    rf = _rule_fallback(
        p.voice_transcript or "",
        p.age,
        p.condition,
    )
    return rf


@app.post("/recommend/slot", response_model=SlotResponse, tags=["Scheduling"])
async def recommend_slot(patient: PatientFeatures):
    rf = _features_to_triage_dict(patient)
    score = float(rf["risk_score"])
    band = _risk_band(score)
    pr = _p_to_hml(str(rf.get("priority", "P3")))
    ranked = await asyncio.to_thread(
        score_slots,
        score,
        pr,
        patient.urgency,
        patient.preferred_doctor,
        patient.language or "English",
        band,
    )
    return SlotResponse(
        top_slots=ranked[:3],
        patient_summary={
            "ml_risk_score": score,
            "ml_risk_band": band,
            "ml_priority": pr,
            "scheduler": "OR-Tools CP-SAT",
        },
    )


# ── Entry (Render uses $PORT) ───────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    _port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=_port, reload=False)
