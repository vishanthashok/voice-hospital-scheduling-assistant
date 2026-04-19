"""
Full FHIR R4 export: Patient + RiskAssessment (SHAP) + Communication (voice transcript).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fhir.resources.annotation import Annotation
from fhir.resources.bundle import Bundle, BundleEntry
from fhir.resources.communication import Communication
from fhir.resources.humanname import HumanName
from fhir.resources.patient import Patient
from fhir.resources.reference import Reference
from fhir.resources.riskassessment import RiskAssessment as RiskAssessmentResource

from interop.fhir_risk_assessment import build_risk_assessment_fhir


def _gender_fhir(g: str) -> str:
    g = (g or "").strip().upper()[:1]
    if g == "M":
        return "male"
    if g == "F":
        return "female"
    return "unknown"


def build_full_export_bundle(
    *,
    patient_id: str,
    patient_display_name: str,
    gender_str: str,
    voice_transcript: str,
    risk_score: float,
    risk_band: str,
    priority: str,
    priority_confidence: float,
    shap_explanation: Dict[str, Any],
    patient_reference: Optional[str] = None,
    assessment_id: Optional[str] = None,
    bundle_id: Optional[str] = None,
) -> Dict[str, Any]:
    pref = patient_reference or f"Patient/{patient_id}"
    aid = assessment_id or f"medivoice-risk-{patient_id}"
    bid = bundle_id or f"export-{patient_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    when = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    parts = patient_display_name.strip().split(None, 1)
    given = [parts[0]] if parts else ["Unknown"]
    family = parts[1] if len(parts) > 1 else "Unknown"

    pat = Patient(
        id=patient_id,
        active=True,
        name=[HumanName(use="official", family=family, given=given)],
        gender=_gender_fhir(gender_str),
    )

    ra_dict = build_risk_assessment_fhir(
        risk_score=risk_score,
        risk_band=risk_band,
        priority=priority,
        priority_confidence=priority_confidence,
        shap_explanation=shap_explanation,
        patient_reference=pref,
        assessment_id=aid,
        occurrence_iso=when,
    )
    ra_res = RiskAssessmentResource.model_validate(ra_dict)

    tx = (voice_transcript or "").strip() or "No voice transcript supplied for this export."
    comm = Communication(
        id=f"comm-voice-{patient_id}",
        status="completed",
        subject=Reference(reference=pref),
        note=[Annotation(text=tx[:8000])],
    )

    entries: List[BundleEntry] = [
        BundleEntry(fullUrl=f"urn:uuid:patient-{patient_id}", resource=pat),
        BundleEntry(fullUrl=f"urn:uuid:ra-{aid}", resource=ra_res),
        BundleEntry(fullUrl=f"urn:uuid:comm-{patient_id}", resource=comm),
    ]

    b = Bundle(
        id=bid,
        type="collection",
        timestamp=when,
        entry=entries,
    )
    return b.model_dump(mode="json", exclude_none=True)
