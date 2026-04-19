"""
HL7 FHIR R4 RiskAssessment builder (fhir.resources).
Serializes to JSON suitable for downstream EHR ingestion (Epic/Cerner SMART on FHIR pipelines).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fhir.resources.codeableconcept import CodeableConcept
from fhir.resources.coding import Coding
from fhir.resources.reference import Reference
from fhir.resources.riskassessment import RiskAssessment, RiskAssessmentPrediction


def build_risk_assessment_fhir(
    *,
    risk_score: float,
    risk_band: str,
    priority: str,
    priority_confidence: float,
    shap_explanation: Dict[str, Any],
    patient_reference: str = "Patient/medivoice-demo-1",
    assessment_id: str = "medivoice-risk-1",
    occurrence_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Map ML outputs + SHAP explanation to a FHIR R4 RiskAssessment resource (dict / JSON).

    shap_explanation: top feature rows + rationale dict
      { "top_contributions": [...], "clinical_rationale": {...} }
    """
    when = occurrence_iso or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    preds: List[RiskAssessmentPrediction] = []

    preds.append(
        RiskAssessmentPrediction(
            outcome=CodeableConcept(
                text=f"Predicted risk score {risk_score:.1f} / 100 ({risk_band})"
            ),
            relativeRisk=float(risk_score) / 100.0,
            rationale=(
                "MediVoice triage risk score; "
                "band thresholds: Low <35, Moderate <60, High <80, Critical ≥80."
            ),
        )
    )

    preds.append(
        RiskAssessmentPrediction(
            outcome=CodeableConcept(text=f"Triage priority: {priority}"),
            probabilityDecimal=float(priority_confidence),
            rationale="Triage priority classification (Low / Medium / High).",
        )
    )

    for row in shap_explanation.get("top_contributions", [])[:3]:
        fname = str(row.get("feature", ""))
        shap_v = row.get("shap_value")
        direction = row.get("direction", "")
        rationale_txt = str(row.get("clinical_rationale", ""))
        preds.append(
            RiskAssessmentPrediction(
                outcome=CodeableConcept(text=f"Feature attribution — {fname}"),
                rationale=(
                    f"{rationale_txt} (attribution={shap_v}, {direction}). "
                    "Top factors from Gemini feature attribution or rule-based fallback."
                ),
            )
        )

    method = CodeableConcept(
        text="MediVoice triage — Gemini API with rule-based fallback",
        coding=[
            Coding(
                system="https://medivoice.local/fhir/CodeSystem/ml-method",
                code="risk-v1",
                display="MediVoice triage engine",
            )
        ],
    )

    ra = RiskAssessment(
        id=assessment_id,
        status="final",
        subject=Reference(reference=patient_reference),
        occurrenceDateTime=when,
        method=method,
        code=CodeableConcept(text="Population health / scheduling risk stratification"),
        prediction=preds,
    )

    return ra.model_dump(mode="json", exclude_none=True)


def fhir_json_dumps(ra_dict: Dict[str, Any]) -> str:
    import json

    return json.dumps(ra_dict, indent=2)
