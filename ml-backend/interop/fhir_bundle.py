"""
FHIR R4 Bundle: Patient + Observation (risk score) + RiskAssessment (ML + SHAP).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fhir.resources.bundle import Bundle, BundleEntry
from fhir.resources.codeableconcept import CodeableConcept
from fhir.resources.coding import Coding
from fhir.resources.humanname import HumanName
from fhir.resources.observation import Observation
from fhir.resources.patient import Patient
from fhir.resources.quantity import Quantity
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


def build_triage_bundle_with_demographics(
    *,
    patient_id: str,
    patient_display_name: str,
    gender_str: str,
    risk_score: float,
    risk_band: str,
    priority: str,
    priority_confidence: float,
    shap_explanation: Dict[str, Any],
    patient_reference: str,
    assessment_id: str,
    bundle_id: str,
    occurrence_iso: str,
) -> Dict[str, Any]:
    parts = patient_display_name.strip().split(None, 1)
    given = [parts[0]] if parts else ["Unknown"]
    family = parts[1] if len(parts) > 1 else "Unknown"

    pat = Patient(
        id=patient_id,
        active=True,
        name=[HumanName(use="official", family=family, given=given)],
        gender=_gender_fhir(gender_str),
    )

    obs = Observation(
        id=f"obs-risk-{patient_id}",
        status="final",
        category=[
            CodeableConcept(
                coding=[
                    Coding(
                        system="http://terminology.hl7.org/CodeSystem/observation-category",
                        code="survey",
                        display="Survey",
                    )
                ]
            )
        ],
        code=CodeableConcept(
            text=f"MediVoice composite clinical risk score — band {risk_band}",
            coding=[
                Coding(
                    system="http://loinc.org",
                    code="65853-7",
                    display="Fatigue severity [Wong-Baker Faces Pain Scale]",
                )
            ],
        ),
        subject=Reference(reference=patient_reference),
        effectiveDateTime=occurrence_iso,
        valueQuantity=Quantity(
            value=float(risk_score),
            unit="score",
            system="https://medivoice.local/fhir/CodeSystem/units",
            code="mediavoice-risk-0-100",
        ),
    )

    ra_dict = build_risk_assessment_fhir(
        risk_score=risk_score,
        risk_band=risk_band,
        priority=priority,
        priority_confidence=priority_confidence,
        shap_explanation=shap_explanation,
        patient_reference=patient_reference,
        assessment_id=assessment_id,
        occurrence_iso=occurrence_iso,
    )
    ra_res = RiskAssessmentResource.model_validate(ra_dict)

    entries: List[BundleEntry] = [
        BundleEntry(fullUrl=f"urn:uuid:patient-{patient_id}", resource=pat),
        BundleEntry(fullUrl=f"urn:uuid:obs-{patient_id}", resource=obs),
        BundleEntry(fullUrl=f"urn:uuid:ra-{assessment_id}", resource=ra_res),
    ]

    b = Bundle(
        id=bundle_id,
        type="collection",
        timestamp=occurrence_iso,
        entry=entries,
    )
    return b.model_dump(mode="json", exclude_none=True)


def build_triage_bundle(
    *,
    patient_id: str,
    patient_display_name: str,
    gender_str: str,
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
    bid = bundle_id or f"bundle-{patient_id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    when = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return build_triage_bundle_with_demographics(
        patient_id=patient_id,
        patient_display_name=patient_display_name,
        gender_str=gender_str,
        risk_score=risk_score,
        risk_band=risk_band,
        priority=priority,
        priority_confidence=priority_confidence,
        shap_explanation=shap_explanation,
        patient_reference=pref,
        assessment_id=aid,
        bundle_id=bid,
        occurrence_iso=when,
    )
