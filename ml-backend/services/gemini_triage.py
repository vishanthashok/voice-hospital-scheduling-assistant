"""
Gemini-backed triage orchestrator (default: gemini-2.0-flash) with deterministic rule-based fallback.

Requires GEMINI_API_KEY in environment (project root .env or ml-backend/.env).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

# Load env from repo root and ml-backend
_root = Path(__file__).resolve().parents[2]
_ml = Path(__file__).resolve().parents[1]
load_dotenv(_root / ".env")
load_dotenv(_ml / ".env")

logger = logging.getLogger("medivoice-ml")

# Use Google AI Studio model ids: gemini-2.0-flash (default), gemini-1.5-flash, gemini-1.5-pro, etc.
GEMINI_MODEL = os.getenv("GEMINI_TRIAGE_MODEL", "gemini-2.0-flash")

# Short-lived cache so parallel /predict/risk + /predict/priority share one API call
_CACHE: Dict[str, Tuple[float, "TriageResult"]] = {}
_CACHE_TTL_SEC = 90.0


@dataclass
class TriageResult:
    risk_score: float
    risk_band: str
    clinical_rationale: Dict[str, str]
    top_shap_contributions: List[Dict[str, Any]]
    priority: str  # High | Medium | Low
    confidence: float
    probabilities: Dict[str, float]
    fhir_risk_assessment: Optional[Dict[str, Any]]
    source: str  # "gemini" | "rules"
    suggested_action: str


def _patient_dict(p: Any) -> Dict[str, Any]:
    if hasattr(p, "model_dump"):
        return p.model_dump(exclude_none=True)
    return dict(p)


def _cache_key(p: Any) -> str:
    raw = json.dumps(_patient_dict(p), sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def risk_band(score: float) -> str:
    if score >= 80:
        return "Critical"
    if score >= 60:
        return "High"
    if score >= 35:
        return "Moderate"
    return "Low"


def _p_level_to_hml(p: str) -> str:
    p = (p or "P3").strip().upper()
    if p == "P1":
        return "High"
    if p == "P2":
        return "Medium"
    return "Low"


def _hml_to_probs(hml: str) -> Dict[str, float]:
    if hml == "High":
        return {"High": 0.72, "Medium": 0.2, "Low": 0.08}
    if hml == "Medium":
        return {"High": 0.15, "Medium": 0.65, "Low": 0.2}
    return {"High": 0.08, "Medium": 0.22, "Low": 0.7}


def rule_based_triage(patient: Any) -> TriageResult:
    """Deterministic fallback — never blocks on external APIs."""
    from data.seed_patients import CONDITION_RISK_MAP

    d = _patient_dict(patient)
    age = int(d.get("age", 50))
    cond = str(d.get("condition", "Unknown"))
    urgency = int(d.get("urgency", 3))
    days = int(d.get("days_since_visit", 30))
    base = float(CONDITION_RISK_MAP.get(cond, 50))
    age_adj = min(12, max(-5, (age - 40) * 0.15))
    urg_adj = (urgency - 3) * 4.0
    days_adj = min(15, days / 10.0)
    score = float(max(5, min(98, base + age_adj + urg_adj + days_adj)))
    rb = risk_band(score)
    if score >= 75:
        pl = "P1"
    elif score >= 42:
        pl = "P2"
    else:
        pl = "P3"
    hml = _p_level_to_hml(pl)
    conf = 0.55

    tops = [
        {
            "feature": "condition_risk",
            "shap_value": round((base / 100.0) * 0.9, 4),
            "direction": "increases_risk",
        },
        {
            "feature": "urgency",
            "shap_value": round(urgency * 0.08, 4),
            "direction": "increases_risk" if urgency >= 3 else "decreases_risk",
        },
        {
            "feature": "days_since_visit",
            "shap_value": round(min(0.4, days / 200.0), 4),
            "direction": "increases_risk",
        },
    ]
    rationale = {
        "condition_risk": f"Baseline burden signal for {cond} (rule-based fallback).",
        "urgency": "Acuity level from structured triage urgency.",
        "days_since_visit": "Interval since last visit (access / follow-up risk).",
        "suggested_action": "Continue standard nursing assessment; escalate per local protocol if symptoms worsen.",
    }
    return TriageResult(
        risk_score=round(score, 1),
        risk_band=rb,
        clinical_rationale=rationale,
        top_shap_contributions=tops,
        priority=hml,
        confidence=conf,
        probabilities=_hml_to_probs(hml),
        fhir_risk_assessment=None,
        source="rules",
        suggested_action="Rule-based triage — verify with clinician.",
    )


def _parse_gemini_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    return json.loads(text)


def get_gemini_triage(patient_data: Dict[str, Any]) -> TriageResult:
    """
    Call Gemini with JSON-only output. Raises on hard failures (caller uses fallback).

    Uses the supported `google-genai` SDK (not deprecated `google.generativeai`).
    """
    from google import genai
    from google.genai import types as genai_types

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")

    client = genai.Client(api_key=api_key)

    system = (
        "You are an expert medical triage assistant for a hospital scheduling demo. "
        "You are NOT diagnosing — you output structured triage-style scores for workflow routing only. "
        "Respond with VALID JSON ONLY — no markdown, no prose outside JSON."
    )

    schema_hint = """
The JSON object MUST have exactly these keys:
{
  "risk_score": <number 0-100>,
  "priority_level": "P1" | "P2" | "P3",
  "clinical_rationale": "<one short sentence>",
  "suggested_action": "<short string e.g. Immediate provider evaluation>",
  "feature_attribution": [
    {"factor": "<string>", "weight": <number 0-1>, "direction": "increases_risk" | "decreases_risk", "note": "<few words>"}
  ],
  "fhir_risk_assessment": <object — valid FHIR R4 RiskAssessment JSON resource as a single object>
}
feature_attribution MUST have exactly 3 items. fhir_risk_assessment MUST be a complete RiskAssessment resource with id, status, subject, occurrenceDateTime, prediction array.
"""

    user = json.dumps(patient_data, indent=2) + "\n" + schema_hint

    cfg = genai_types.GenerateContentConfig(
        system_instruction=system,
        temperature=0.15,
        response_mime_type="application/json",
    )

    resp = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=user,
        config=cfg,
    )
    raw = (resp.text or "").strip()
    if not raw:
        raise RuntimeError("Empty Gemini response")

    data = _parse_gemini_json(raw)

    rs = float(data["risk_score"])
    rs = max(0, min(100, rs))
    rb = risk_band(rs)
    pl = str(data.get("priority_level", "P3")).upper()
    if pl not in ("P1", "P2", "P3"):
        pl = "P3"
    hml = _p_level_to_hml(pl)

    fa = data.get("feature_attribution") or []
    tops = []
    rationale: Dict[str, str] = {}
    for i, row in enumerate(fa[:3]):
        fac = str(row.get("factor", f"factor_{i}"))
        w = float(row.get("weight", 0.3))
        direction = str(row.get("direction", "increases_risk"))
        note = str(row.get("note", ""))
        tops.append(
            {
                "feature": fac.replace(" ", "_")[:64],
                "shap_value": round(w * (1.0 if "increase" in direction else -0.7), 4),
                "direction": direction,
            }
        )
        rationale[fac.replace(" ", "_")[:64]] = note or "Attributed factor from Gemini."

    rationale["one_liner"] = str(data.get("clinical_rationale", ""))
    rationale["suggested_action"] = str(data.get("suggested_action", ""))

    fhir_ra = data.get("fhir_risk_assessment")
    if fhir_ra is not None and not isinstance(fhir_ra, dict):
        fhir_ra = None

    return TriageResult(
        risk_score=round(rs, 1),
        risk_band=rb,
        clinical_rationale=rationale,
        top_shap_contributions=tops,
        priority=hml,
        confidence=0.82,
        probabilities=_hml_to_probs(hml),
        fhir_risk_assessment=fhir_ra,
        source="gemini",
        suggested_action=str(data.get("suggested_action", "")),
    )


def run_triage(patient: Any) -> TriageResult:
    """
    Gemini when possible; on any failure (quota, 503, parse), rule-based fallback.
    Cached briefly for identical patient payloads.
    """
    key = _cache_key(patient)
    now = time.time()
    if key in _CACHE and _CACHE[key][0] > now:
        return _CACHE[key][1]

    try:
        pdata = _patient_dict(patient)
        tr = get_gemini_triage(pdata)
    except Exception as e:
        logger.warning("Gemini triage failed (%s) — using rule-based fallback", e)
        tr = rule_based_triage(patient)

    _CACHE[key] = (now + _CACHE_TTL_SEC, tr)
    return tr


def gemini_configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))
