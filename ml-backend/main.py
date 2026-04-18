"""
main.py — FastAPI ML backend for MediVoice AI
Runs on port 8000. Node.js Express proxies /api/ml/* to here.
"""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import asyncio
import logging
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from data.seed_patients import CONDITION_LIST, SEED_PATIENTS
from interop.fhir_risk_assessment import build_risk_assessment_fhir
from models.priority_model import PriorityModel
from models.risk_model import RiskModel
from models.slot_recommender import score_slots

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medivoice-ml")

# Comma-separated list, e.g. "https://medivoice.onrender.com,http://localhost:5173"
# If unset, allow all origins (dev-friendly; set explicitly in production on Render).
_cors_raw = os.getenv("CORS_ORIGINS", "").strip()
_cors_origins: List[str] = (
    [o.strip() for o in _cors_raw.split(",") if o.strip()]
    if _cors_raw
    else ["*"]
)

# ── App setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="MediVoice AI — ML Backend",
    description="Patient risk scoring, priority classification, and smart slot recommendation.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Initialise and train models at startup ───────────────────────────────────
risk_model     = RiskModel()
priority_model = PriorityModel()
risk_metrics: dict     = {}
priority_metrics: dict = {}


@app.on_event("startup")
async def startup_event():
    global risk_metrics, priority_metrics
    logger.info("MediVoice ML backend starting — training models...")
    risk_metrics     = await asyncio.to_thread(risk_model.train)
    priority_metrics = await asyncio.to_thread(priority_model.train)
    logger.info("All models ready.")


# ── Request/response schemas ─────────────────────────────────────────────────

class PatientFeatures(BaseModel):
    age:              int             = Field(..., ge=0, le=120, example=65)
    gender:           str             = Field(..., example="M")
    condition:        str             = Field(..., example="Diabetes")
    urgency:          int             = Field(..., ge=1, le=5, example=4)
    days_since_visit: int             = Field(..., ge=0, example=30)
    insurance:        str             = Field("Aetna", example="Medicare")
    language:         Optional[str]   = Field("English", example="English")
    preferred_doctor: Optional[str]   = Field(None, example="Dr. Patel")

class ShapFeatureItem(BaseModel):
    feature: str
    shap_value: float
    direction: str


class RiskResponse(BaseModel):
    risk_score: float
    risk_band: str  # "Low" | "Moderate" | "High" | "Critical"
    clinical_rationale: Dict[str, str] = Field(
        default_factory=dict,
        description="Top SHAP features → human-readable clinical copy",
    )
    top_shap_contributions: List[ShapFeatureItem] = Field(default_factory=list)


class PriorityResponse(BaseModel):
    priority:      str
    confidence:    float
    probabilities: dict

class SlotRecommendation(BaseModel):
    slot_id:     str
    day:         str
    time:        str
    doctor:      str
    doctor_load: str
    score:       float
    reasoning:   dict

class SlotResponse(BaseModel):
    top_slots:   List[SlotRecommendation]
    patient_summary: dict

class BatchPatientIn(BaseModel):
    patients: List[PatientFeatures]


class FhirRiskAssessmentRequest(BaseModel):
    patient: PatientFeatures
    patient_reference: str = Field(
        "Patient/medivoice-demo-1",
        description="FHIR Reference.reference for the subject Patient",
    )
    assessment_id: str = Field("medivoice-risk-1", description="Business id for RiskAssessment.id")


# ── Helpers ───────────────────────────────────────────────────────────────────

def risk_band(score: float) -> str:
    if score >= 80: return "Critical"
    if score >= 60: return "High"
    if score >= 35: return "Moderate"
    return "Low"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {"status": "ok", "service": "MediVoice ML Backend v1.0.0"}


@app.get("/health", tags=["Health"])
async def health():
    return {
        "status": "healthy",
        "risk_model_ready":     risk_model.model is not None,
        "priority_model_ready": priority_model.model is not None,
    }


@app.post("/predict/risk", response_model=RiskResponse, tags=["Prediction"])
async def predict_risk(patient: PatientFeatures):
    """Predict a patient's medical risk score (0–100) with SHAP-based rationale."""
    try:
        score = await asyncio.to_thread(
            risk_model.predict,
            patient.age,
            patient.gender,
            patient.condition,
            patient.urgency,
            patient.days_since_visit,
            patient.insurance,
        )
        expl = await asyncio.to_thread(
            risk_model.get_explanation,
            patient.age,
            patient.gender,
            patient.condition,
            patient.urgency,
            patient.days_since_visit,
            patient.insurance,
        )
        tops = expl.get("top_contributions", [])
        items = [
            ShapFeatureItem(
                feature=t["feature"],
                shap_value=float(t["shap_value"]),
                direction=str(t["direction"]),
            )
            for t in tops
        ]
        return RiskResponse(
            risk_score=score,
            risk_band=risk_band(score),
            clinical_rationale=expl.get("clinical_rationale", {}),
            top_shap_contributions=items,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/priority", response_model=PriorityResponse, tags=["Prediction"])
async def predict_priority(patient: PatientFeatures):
    """Classify a patient's triage priority: High / Medium / Low."""
    try:
        result = await asyncio.to_thread(
            priority_model.predict,
            patient.age,
            patient.gender,
            patient.condition,
            patient.urgency,
            patient.days_since_visit,
            patient.insurance,
        )
        return PriorityResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recommend/slot", response_model=SlotResponse, tags=["Scheduling"])
async def recommend_slot(patient: PatientFeatures):
    """Top 3 slots via OR-Tools CP-SAT (minimize wait × risk, burnout caps)."""
    try:
        risk_score = await asyncio.to_thread(
            risk_model.predict,
            patient.age,
            patient.gender,
            patient.condition,
            patient.urgency,
            patient.days_since_visit,
            patient.insurance,
        )
        rb = risk_band(risk_score)
        priority_res = await asyncio.to_thread(
            priority_model.predict,
            patient.age,
            patient.gender,
            patient.condition,
            patient.urgency,
            patient.days_since_visit,
            patient.insurance,
        )
        ranked = await asyncio.to_thread(
            score_slots,
            risk_score,
            priority_res["priority"],
            patient.urgency,
            patient.preferred_doctor,
            patient.language or "English",
            rb,
        )
        return SlotResponse(
            top_slots=[SlotRecommendation(**s) for s in ranked[:3]],
            patient_summary={
                "ml_risk_score":    risk_score,
                "ml_risk_band":     rb,
                "ml_priority":      priority_res["priority"],
                "ml_confidence":    priority_res["confidence"],
                "scheduler":      "OR-Tools CP-SAT (wait×risk objective, 2h burnout cap)",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/interop/fhir/RiskAssessment", tags=["Interop"])
async def fhir_risk_assessment(body: FhirRiskAssessmentRequest):
    """Serialize ML outputs + SHAP into a FHIR R4 RiskAssessment JSON resource."""
    try:
        p = body.patient
        risk_score = await asyncio.to_thread(
            risk_model.predict,
            p.age,
            p.gender,
            p.condition,
            p.urgency,
            p.days_since_visit,
            p.insurance,
        )
        expl = await asyncio.to_thread(
            risk_model.get_explanation,
            p.age,
            p.gender,
            p.condition,
            p.urgency,
            p.days_since_visit,
            p.insurance,
        )
        prio = await asyncio.to_thread(
            priority_model.predict,
            p.age,
            p.gender,
            p.condition,
            p.urgency,
            p.days_since_visit,
            p.insurance,
        )
        ra = await asyncio.to_thread(
            lambda: build_risk_assessment_fhir(
                risk_score=risk_score,
                risk_band=risk_band(risk_score),
                priority=prio["priority"],
                priority_confidence=float(prio["confidence"]),
                shap_explanation=expl,
                patient_reference=body.patient_reference,
                assessment_id=body.assessment_id,
            )
        )
        return ra
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _batch_score_sync(body: BatchPatientIn) -> dict:
    results = []
    for p in body.patients:
        try:
            risk = risk_model.predict(
                age=p.age, gender=p.gender, condition=p.condition,
                urgency=p.urgency, days_since_visit=p.days_since_visit,
                insurance=p.insurance,
            )
            prio = priority_model.predict(
                age=p.age, gender=p.gender, condition=p.condition,
                urgency=p.urgency, days_since_visit=p.days_since_visit,
                insurance=p.insurance,
            )
            results.append({
                "risk_score":   risk,
                "risk_band":    risk_band(risk),
                "priority":     prio["priority"],
                "confidence":   prio["confidence"],
                "probabilities": prio["probabilities"],
            })
        except Exception as e:
            results.append({"error": str(e)})
    return {"results": results, "count": len(results)}


@app.post("/batch/score", tags=["Batch"])
async def batch_score(body: BatchPatientIn):
    """Score all patients in a single request — powers the 'Recalculate Risk' button."""
    return await asyncio.to_thread(_batch_score_sync, body)


def _batch_seed_sync() -> dict:
    results = []
    for p in SEED_PATIENTS:
        risk = risk_model.predict(
            age=p["age"], gender=p["gender"], condition=p["condition"],
            urgency=p["urgency"], days_since_visit=p["days_since_visit"],
            insurance=p.get("insurance", "Aetna"),
        )
        prio = priority_model.predict(
            age=p["age"], gender=p["gender"], condition=p["condition"],
            urgency=p["urgency"], days_since_visit=p["days_since_visit"],
            insurance=p.get("insurance", "Aetna"),
        )
        results.append({
            "id":           p["id"],
            "name":         p["name"],
            "risk_score":   risk,
            "risk_band":    risk_band(risk),
            "priority":     prio["priority"],
            "confidence":   prio["confidence"],
        })
    return {"results": results, "count": len(results)}


@app.post("/batch/seed", tags=["Batch"])
async def batch_score_seed():
    """Score the 15 built-in seed patients — used for dashboard demo."""
    return await asyncio.to_thread(_batch_seed_sync)


@app.get("/model/info", tags=["Model"])
async def model_info():
    """Return training metrics and feature importances for both models."""
    return {
        "risk_model":     {**risk_metrics,     "type": "RandomForestRegressor"},
        "priority_model": {**priority_metrics, "type": "GradientBoostingClassifier"},
        "conditions_supported": CONDITION_LIST,
    }


@app.get("/model/retrain", tags=["Model"])
async def retrain():
    """Force-retrain both models (clears cache)."""
    global risk_metrics, priority_metrics
    risk_metrics     = await asyncio.to_thread(risk_model.train, True)
    priority_metrics = await asyncio.to_thread(priority_model.train, True)
    return {
        "message":        "Models retrained successfully",
        "risk_metrics":   risk_metrics,
        "priority_metrics": priority_metrics,
    }
