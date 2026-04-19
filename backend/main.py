"""
MediVoice AI 2.0 — Gemini clinical orchestrator (lean FastAPI, no local ML).

Strict Gemini-only triage:
  - If GEMINI_API_KEY is missing  → 503 (Connecting to AI…)
  - If the Gemini call itself fails → 502 (model error, surfaced in detail)

No silent "rule-based fallback" — caller must see the error.
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

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from dotenv import load_dotenv
from pydantic import BaseModel, Field

_ROOT = Path(__file__).resolve().parent
_REPO = _ROOT.parent
# override=True is critical: otherwise a stale user-level Windows env var
# (e.g. an old invalid GEMINI_API_KEY) silently shadows the .env file's value.
load_dotenv(_REPO / ".env", override=True)
load_dotenv(_ROOT / ".env", override=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medivoice")

DATA_DIR = _ROOT / "data"
HISTORY_PATH = DATA_DIR / "triage_history.jsonl"
GEMINI_MODEL = os.getenv("GEMINI_MODEL") or os.getenv("GEMINI_TRIAGE_MODEL") or "gemini-1.5-flash"

# ── Key detection on import (so `uvicorn main:app` prints this banner once) ─
_GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if _GEMINI_KEY:
    print(f"API KEY DETECTED (len={len(_GEMINI_KEY)}, prefix={_GEMINI_KEY[:8]}..., model={GEMINI_MODEL})")
else:
    print("API KEY MISSING — set GEMINI_API_KEY in .env (triage will return 503)")


app = FastAPI(title="MediVoice AI 2.0", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Twilio live call + SSE (dashboard "LIVE CALL IN PROGRESS") ─────────────
VOICE_SSE_QUEUES: set[asyncio.Queue] = set()
ACTIVE_CALL_SIDS: set[str] = set()


def _public_base() -> str:
    return (os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")


def _voice_action_url(path: str) -> str:
    base = _public_base()
    if not base:
        logger.warning("PUBLIC_BASE_URL is unset — Twilio Gather callbacks may fail outside local mocks")
    return f"{base}{path}" if base else path


async def voice_broadcast(payload: dict[str, Any]) -> None:
    for q in list(VOICE_SSE_QUEUES):
        try:
            await q.put(payload)
        except Exception:
            VOICE_SSE_QUEUES.discard(q)


async def _stream_transcript_chars(call_sid: str, full_text: str) -> None:
    acc = ""
    for ch in full_text:
        acc += ch
        await voice_broadcast(
            {
                "type": "transcript_char",
                "call_sid": call_sid,
                "char": ch,
                "accumulated": acc,
            }
        )
        await asyncio.sleep(0.018)


async def _process_gather_result(call_sid: str, speech: str) -> None:
    text = (speech or "").strip()
    if not text:
        await voice_broadcast({"type": "stt_empty", "call_sid": call_sid})
        ACTIVE_CALL_SIDS.discard(call_sid)
        await voice_broadcast({"type": "call_ended", "call_sid": call_sid})
        return
    await _stream_transcript_chars(call_sid, text)
    try:
        raw = await asyncio.to_thread(_run_gemini_sync, text)
    except HTTPException as he:
        await voice_broadcast(
            {"type": "triage_error", "call_sid": call_sid, "detail": he.detail, "status": he.status_code}
        )
        ACTIVE_CALL_SIDS.discard(call_sid)
        await voice_broadcast({"type": "call_ended", "call_sid": call_sid})
        return

    event_id = str(uuid.uuid4())
    await voice_broadcast(
        {
            "type": "triage_complete",
            "call_sid": call_sid,
            "event_id": event_id,
            "risk_score": raw["risk_score"],
            "priority": raw["priority"],
            "rationale": raw["rationale"],
            "top_drivers": raw["top_drivers"],
            "source": raw["source"],
        }
    )
    _append_audit(
        {
            "ts": _utc_now(),
            "event_id": event_id,
            "channel": "twilio_voice",
            "call_sid": call_sid,
            "risk_score": raw["risk_score"],
            "priority": raw["priority"],
            "source": raw["source"],
            "transcript_excerpt": text[:500],
        }
    )
    ACTIVE_CALL_SIDS.discard(call_sid)
    await voice_broadcast({"type": "call_ended", "call_sid": call_sid})


# ── Schemas (keys MUST match the React frontend exactly) ────────────────────


class TriageIn(BaseModel):
    voice_transcript: str = Field(..., min_length=1)
    patient_id: Optional[str] = None
    patient_name: Optional[str] = None


class TriageOut(BaseModel):
    event_id: str
    risk_score: int = Field(..., ge=0, le=100)
    priority: Literal["P1", "P2", "P3"]
    rationale: str
    top_drivers: list[str]
    source: Literal["gemini"]


class ExportIn(BaseModel):
    """Build FHIR RiskAssessment from live Gemini triage output."""

    patient_id: Optional[str] = None
    patient_name: Optional[str] = None
    risk_score: int
    priority: str
    rationale: str
    top_drivers: list[str] = Field(default_factory=list)
    occurrence_datetime: Optional[str] = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append_audit(record: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, default=str) + "\n"
    with open(HISTORY_PATH, "a", encoding="utf-8") as f:
        f.write(line)


# ── Gemini (google-generativeai) — the ONLY triage path ─────────────────────

_TRIAGE_SYSTEM = (
    "You are a Board-Certified Triage Nurse performing clinical reasoning for a "
    "hospital scheduling dashboard. You do NOT issue a diagnosis. "
    "Return a JSON object ONLY (no markdown fences, no prose) with EXACTLY these keys:\n"
    '  "risk_score": integer 0-100 (higher = more acute),\n'
    '  "priority": "P1" | "P2" | "P3" (P1 = emergent, P2 = urgent, P3 = routine),\n'
    '  "rationale": short natural-language clinical reasoning (1-3 sentences),\n'
    '  "top_drivers": array of EXACTLY 3 short labels (e.g. "Chest Pain", "High HR", "Age > 65").\n'
    "Be conservative: red-flag symptoms (chest pain, shortness of breath, stroke signs, "
    "severe bleeding, suicidal ideation) → risk_score >= 80 and priority P1."
)


def _strip_fence(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return raw.strip()


def _run_gemini_sync(transcript: str) -> dict[str, Any]:
    """Strict Gemini call. Raises HTTPException on any failure — no silent fallback."""
    import google.generativeai as genai

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="Connecting to AI… GEMINI_API_KEY is missing on the server.",
        )

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            GEMINI_MODEL,
            system_instruction=_TRIAGE_SYSTEM,
            generation_config=genai.GenerationConfig(
                temperature=0.2,
                response_mime_type="application/json",
            ),
        )
        prompt = (
            "You are a Board-Certified Triage Nurse. Analyze this transcript:\n"
            f'"""{transcript.strip()}"""\n'
            "Return a JSON object with: risk_score (integer 0-100), "
            'priority (P1/P2/P3), rationale (natural language), and 3 top_drivers '
            "(e.g. 'Chest Pain', 'High HR')."
        )
        resp = model.generate_content(prompt)
        raw = (resp.text or "").strip()
        if not raw:
            raise RuntimeError("Gemini returned an empty response.")
        data = json.loads(_strip_fence(raw))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Gemini call failed")
        raise HTTPException(status_code=502, detail=f"Gemini call failed: {e}") from e

    try:
        rs = int(round(float(data["risk_score"])))
        rs = max(0, min(100, rs))
        p = str(data["priority"]).upper().strip()
        if p not in ("P1", "P2", "P3"):
            raise ValueError(f"invalid priority '{p}'")
        rationale = str(data.get("rationale") or "").strip() or "No rationale provided."
        drivers_raw = data.get("top_drivers") or []
        if not isinstance(drivers_raw, list):
            raise ValueError("top_drivers must be a list")
        drivers: list[str] = []
        for item in drivers_raw:
            if isinstance(item, str):
                drivers.append(item.strip())
            elif isinstance(item, dict):
                label = item.get("factor") or item.get("label") or item.get("name") or ""
                if label:
                    drivers.append(str(label).strip())
        while len(drivers) < 3:
            drivers.append("—")
        drivers = drivers[:3]
    except Exception as e:
        logger.warning("Gemini returned malformed JSON: %s | raw=%s", e, data)
        raise HTTPException(status_code=502, detail=f"Gemini returned malformed JSON: {e}") from e

    return {
        "risk_score": rs,
        "priority": p,
        "rationale": rationale[:2000],
        "top_drivers": drivers,
        "source": "gemini",
    }


# ── Routes ──────────────────────────────────────────────────────────────────


@app.on_event("startup")
async def _startup_banner() -> None:
    print(f"[medivoice] gemini_model={GEMINI_MODEL} key_detected={bool(_GEMINI_KEY)}")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "medivoice-2",
        "gemini_model": GEMINI_MODEL,
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
    }


@app.post("/triage", response_model=TriageOut)
async def triage(body: TriageIn):
    event_id = str(uuid.uuid4())
    raw = await asyncio.to_thread(_run_gemini_sync, body.voice_transcript)

    out = TriageOut(
        event_id=event_id,
        risk_score=raw["risk_score"],
        priority=raw["priority"],
        rationale=raw["rationale"],
        top_drivers=raw["top_drivers"],
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
    """Minimal valid FHIR R4 RiskAssessment built from live Gemini triage output."""
    rid = str(uuid.uuid4())[:8]
    pid = body.patient_id or "demo-patient"
    occurred = body.occurrence_datetime or _utc_now()
    score = max(0, min(100, int(body.risk_score)))

    driver_str = ", ".join([d for d in (body.top_drivers or []) if d and d != "—"])
    outcome_text = f"Triage priority {body.priority} — {body.rationale[:260]}"
    if driver_str:
        outcome_text += f" Drivers: {driver_str}."

    resource: dict[str, Any] = {
        "resourceType": "RiskAssessment",
        "id": f"ra-{rid}",
        "meta": {"profile": ["http://hl7.org/fhir/StructureDefinition/RiskAssessment"]},
        "status": "final",
        "subject": {"reference": f"Patient/{pid}", "display": body.patient_name or "Patient"},
        "occurrenceDateTime": occurred,
        "prediction": [
            {
                "outcome": {"text": outcome_text},
                "relativeRisk": score / 100.0,
                "qualitativeRisk": {"text": f"Score {score}/100"},
            }
        ],
        "note": [{"text": f"Driver: {d}"} for d in (body.top_drivers or []) if d and d != "—"],
    }
    return resource


# ── Twilio Voice webhooks + SSE + click-to-call ─────────────────────────────


class ClickToCallIn(BaseModel):
    to: str = Field(..., min_length=8, description="E.164, e.g. +15551234567")


@app.get("/voice/stream/sse")
async def voice_events_sse():
    async def event_gen():
        q: asyncio.Queue = asyncio.Queue()
        VOICE_SSE_QUEUES.add(q)
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {json.dumps(msg, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            VOICE_SSE_QUEUES.discard(q)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/voice/incoming")
async def voice_incoming(
    call_sid: str = Form(..., alias="CallSid"),
    from_number: str = Form(default="", alias="From"),
    to_number: str = Form(default="", alias="To"),
):
    from twilio.twiml.voice_response import Gather, VoiceResponse

    ACTIVE_CALL_SIDS.add(call_sid)
    await voice_broadcast(
        {
            "type": "call_started",
            "call_sid": call_sid,
            "from": from_number,
            "to": to_number,
        }
    )

    resp = VoiceResponse()
    resp.say(
        "Welcome to MediVoice. After the tone, briefly describe how you are feeling today.",
        voice="Polly.Joanna-Neural",
    )
    gather = Gather(
        input="speech",
        action=_voice_action_url("/voice/gather"),
        method="POST",
        speech_timeout="auto",
        timeout=10,
        language="en-US",
    )
    gather.say("Go ahead.", voice="Polly.Joanna-Neural")
    resp.append(gather)
    resp.say("We did not hear anything. Goodbye.", voice="Polly.Joanna-Neural")

    return Response(content=str(resp), media_type="application/xml")


@app.post("/voice/gather")
async def voice_gather(
    background_tasks: BackgroundTasks,
    call_sid: str = Form(..., alias="CallSid"),
    speech_result: str = Form(default="", alias="SpeechResult"),
):
    from twilio.twiml.voice_response import VoiceResponse

    background_tasks.add_task(_process_gather_result, call_sid, speech_result)

    resp = VoiceResponse()
    if (speech_result or "").strip():
        resp.say(
            "Thank you. MediVoice is updating your care team. You may hang up now.",
            voice="Polly.Joanna-Neural",
        )
    else:
        resp.say("Sorry, we could not hear you. Goodbye.", voice="Polly.Joanna-Neural")

    return Response(content=str(resp), media_type="application/xml")


@app.post("/voice/click-to-call")
async def voice_click_to_call(body: ClickToCallIn):
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_num = os.getenv("TWILIO_PHONE_NUMBER")
    base = _public_base()
    if not account_sid or not auth_token or not from_num:
        raise HTTPException(status_code=503, detail="Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER")
    if not base:
        raise HTTPException(status_code=503, detail="Set PUBLIC_BASE_URL to your public https URL (ngrok / Render)")

    from twilio.rest import Client

    client = Client(account_sid, auth_token)
    call = client.calls.create(
        to=body.to,
        from_=from_num,
        url=f"{base}/voice/incoming",
        method="POST",
    )
    return {"call_sid": call.sid, "status": call.status}


@app.get("/voice/client-token")
async def voice_client_token(identity: str = "doctor-dashboard"):
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    api_key = os.getenv("TWILIO_API_KEY_SID")
    api_secret = os.getenv("TWILIO_API_KEY_SECRET")
    app_sid = os.getenv("TWILIO_VOICE_APP_SID")
    if not all([account_sid, api_key, api_secret, app_sid]):
        raise HTTPException(
            status_code=503,
            detail="Configure TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_VOICE_APP_SID for browser calling",
        )

    from twilio.jwt.access_token import AccessToken
    from twilio.jwt.access_token.grants import VoiceGrant

    token = AccessToken(account_sid, api_key, api_secret, identity=identity)
    token.add_grant(VoiceGrant(outgoing_application_sid=app_sid, incoming_allow=True))
    jwt = token.to_jwt()
    if isinstance(jwt, bytes):
        jwt = jwt.decode("utf-8")
    return {"identity": identity, "token": jwt}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
