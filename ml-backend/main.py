"""
main.py — FastAPI ML backend for MediVoice AI
Runs on port 8000. Node.js Express proxies /api/ml/* to here.
"""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
import logging

from models.risk_model import RiskModel
from models.priority_model import PriorityModel
from models.slot_recommender import score_slots
from data.seed_patients import SEED_PATIENTS, encode_patient, CONDITION_LIST

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medivoice-ml")

# ── App setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="MediVoice AI — ML Backend",
    description="Patient risk scoring, priority classification, and smart slot recommendation.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    logger.info("🚀 MediVoice ML backend starting — training models...")
    risk_metrics     = risk_model.train()
    priority_metrics = priority_model.train()
    logger.info("✅ All models ready.")


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

class RiskResponse(BaseModel):
    risk_score: float
    risk_band:  str    # "Low" | "Moderate" | "High" | "Critical"

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def risk_band(score: float) -> str:
    if score >= 80: return "Critical"
    if score >= 60: return "High"
    if score >= 35: return "Moderate"
    return "Low"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
def root():
    return {"status": "ok", "service": "MediVoice ML Backend v1.0.0"}


@app.get("/health", tags=["Health"])
def health():
    return {
        "status": "healthy",
        "risk_model_ready":     risk_model.model is not None,
        "priority_model_ready": priority_model.model is not None,
    }


@app.post("/predict/risk", response_model=RiskResponse, tags=["Prediction"])
def predict_risk(patient: PatientFeatures):
    """Predict a patient's medical risk score (0–100)."""
    try:
        score = risk_model.predict(
            age=patient.age,
            gender=patient.gender,
            condition=patient.condition,
            urgency=patient.urgency,
            days_since_visit=patient.days_since_visit,
            insurance=patient.insurance,
        )
        return RiskResponse(risk_score=score, risk_band=risk_band(score))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/predict/priority", response_model=PriorityResponse, tags=["Prediction"])
def predict_priority(patient: PatientFeatures):
    """Classify a patient's triage priority: High / Medium / Low."""
    try:
        result = priority_model.predict(
            age=patient.age,
            gender=patient.gender,
            condition=patient.condition,
            urgency=patient.urgency,
            days_since_visit=patient.days_since_visit,
            insurance=patient.insurance,
        )
        return PriorityResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/recommend/slot", response_model=SlotResponse, tags=["Scheduling"])
def recommend_slot(patient: PatientFeatures):
    """Return the top 3 appointment slots for a patient using ML-informed scoring."""
    try:
        # Get ML outputs first
        risk_score = risk_model.predict(
            age=patient.age,
            gender=patient.gender,
            condition=patient.condition,
            urgency=patient.urgency,
            days_since_visit=patient.days_since_visit,
            insurance=patient.insurance,
        )
        priority_res = priority_model.predict(
            age=patient.age,
            gender=patient.gender,
            condition=patient.condition,
            urgency=patient.urgency,
            days_since_visit=patient.days_since_visit,
            insurance=patient.insurance,
        )
        ranked = score_slots(
            risk_score=risk_score,
            priority=priority_res["priority"],
            urgency=patient.urgency,
            preferred_doctor=patient.preferred_doctor,
            language=patient.language or "English",
        )
        return SlotResponse(
            top_slots=[SlotRecommendation(**s) for s in ranked[:3]],
            patient_summary={
                "ml_risk_score":    risk_score,
                "ml_risk_band":     risk_band(risk_score),
                "ml_priority":      priority_res["priority"],
                "ml_confidence":    priority_res["confidence"],
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/batch/score", tags=["Batch"])
def batch_score(body: BatchPatientIn):
    """Score all patients in a single request — powers the 'Recalculate Risk' button."""
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


@app.post("/batch/seed", tags=["Batch"])
def batch_score_seed():
    """Score the 15 built-in seed patients — used for dashboard demo."""
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


@app.get("/model/info", tags=["Model"])
def model_info():
    """Return training metrics and feature importances for both models."""
    return {
        "risk_model":     {**risk_metrics,     "type": "RandomForestRegressor"},
        "priority_model": {**priority_metrics, "type": "GradientBoostingClassifier"},
        "conditions_supported": CONDITION_LIST,
    }


@app.get("/model/retrain", tags=["Model"])
def retrain():
    """Force-retrain both models (clears cache)."""
    global risk_metrics, priority_metrics
    risk_metrics     = risk_model.train(force=True)
    priority_metrics = priority_model.train(force=True)
    return {
        "message":        "Models retrained successfully",
        "risk_metrics":   risk_metrics,
        "priority_metrics": priority_metrics,
    }
