"""
seed_patients.py
Base patient dataset + synthetic augmentation for ML model training.
"""
import numpy as np
import pandas as pd
from typing import List, Dict

# ── Base 15-patient seed records ───────────────────────────────────────────
SEED_PATIENTS: List[Dict] = [
    {"id": "P001", "name": "John Martinez",   "age": 62, "gender": "M", "condition": "Hypertension",           "priority": "Medium", "days_since_visit": 17, "risk_score": 64, "insurance": "Blue Cross",   "urgency": 3},
    {"id": "P002", "name": "Aisha Khan",       "age": 29, "gender": "F", "condition": "Asthma",                 "priority": "Low",    "days_since_visit": 9,  "risk_score": 22, "insurance": "Aetna",        "urgency": 1},
    {"id": "P003", "name": "Michael Johnson",  "age": 71, "gender": "M", "condition": "Diabetes",               "priority": "High",   "days_since_visit": 57, "risk_score": 87, "insurance": "Medicare",     "urgency": 5},
    {"id": "P004", "name": "Sophia Lee",       "age": 45, "gender": "F", "condition": "Chronic back pain",      "priority": "Medium", "days_since_visit": 24, "risk_score": 45, "insurance": "Cigna",        "urgency": 3},
    {"id": "P005", "name": "Carlos Rivera",    "age": 38, "gender": "M", "condition": "Anxiety",                "priority": "Low",    "days_since_visit": 13, "risk_score": 30, "insurance": "Medicaid",     "urgency": 2},
    {"id": "P006", "name": "Emily Davis",      "age": 54, "gender": "F", "condition": "COPD",                   "priority": "High",   "days_since_visit": 34, "risk_score": 78, "insurance": "UnitedHealth", "urgency": 4},
    {"id": "P007", "name": "David Wilson",     "age": 67, "gender": "M", "condition": "Heart disease",          "priority": "High",   "days_since_visit": 39, "risk_score": 91, "insurance": "Medicare",     "urgency": 5},
    {"id": "P008", "name": "Maria Gonzalez",   "age": 33, "gender": "F", "condition": "Thyroid disorder",       "priority": "Low",    "days_since_visit": 6,  "risk_score": 18, "insurance": "Medicaid",     "urgency": 1},
    {"id": "P009", "name": "James Brown",      "age": 59, "gender": "M", "condition": "Arthritis",              "priority": "Medium", "days_since_visit": 19, "risk_score": 55, "insurance": "Blue Cross",   "urgency": 3},
    {"id": "P010", "name": "Olivia Smith",     "age": 26, "gender": "F", "condition": "Migraine",               "priority": "Low",    "days_since_visit": 53, "risk_score": 15, "insurance": "Aetna",        "urgency": 1},
    {"id": "P011", "name": "Robert Taylor",    "age": 74, "gender": "M", "condition": "Hypertension",           "priority": "High",   "days_since_visit": 26, "risk_score": 82, "insurance": "Medicare",     "urgency": 4},
    {"id": "P012", "name": "Neha Patel",       "age": 41, "gender": "F", "condition": "Diabetes",               "priority": "Medium", "days_since_visit": 12, "risk_score": 48, "insurance": "Cigna",        "urgency": 3},
    {"id": "P013", "name": "Daniel Kim",       "age": 50, "gender": "M", "condition": "Post-surgery follow-up", "priority": "High",   "days_since_visit": 32, "risk_score": 73, "insurance": "UnitedHealth", "urgency": 4},
    {"id": "P014", "name": "Linda Moore",      "age": 63, "gender": "F", "condition": "Heart disease",          "priority": "High",   "days_since_visit": 45, "risk_score": 89, "insurance": "Medicare",     "urgency": 5},
    {"id": "P015", "name": "Ahmed Ali",        "age": 47, "gender": "M", "condition": "Asthma",                 "priority": "Medium", "days_since_visit": 14, "risk_score": 38, "insurance": "Blue Cross",   "urgency": 3},
]

# ── Encoding maps ───────────────────────────────────────────────────────────
CONDITION_RISK_MAP = {
    "Heart disease":          90,
    "COPD":                   80,
    "Diabetes":               75,
    "Hypertension":           70,
    "Post-surgery follow-up": 72,
    "Arthritis":              50,
    "Chronic back pain":      45,
    "Anxiety":                35,
    "Asthma":                 38,
    "Thyroid disorder":       25,
    "Migraine":               20,
}

PRIORITY_MAP = {"Low": 0, "Medium": 1, "High": 2}
INSURANCE_MAP = {"Medicaid": 0, "Medicare": 1, "Aetna": 2, "Cigna": 3, "Blue Cross": 4, "UnitedHealth": 5}
GENDER_MAP = {"M": 0, "F": 1}

CONDITION_LIST = list(CONDITION_RISK_MAP.keys())


def encode_patient(p: dict) -> dict:
    """Convert raw patient dict to ML-ready numeric features."""
    return {
        "age":               p["age"],
        "gender":            GENDER_MAP.get(p["gender"], 0),
        "condition_risk":    CONDITION_RISK_MAP.get(p["condition"], 50),
        "urgency":           p.get("urgency", 3),
        "days_since_visit":  p.get("days_since_visit", 30),
        "insurance_ord":     INSURANCE_MAP.get(p.get("insurance", "Aetna"), 2),
    }


def augment_dataset(n_augmented: int = 600, seed: int = 42) -> pd.DataFrame:
    """
    Generate a synthetic training set by adding realistic Gaussian noise
    to the 15 seed patients. Also builds additional patients from scratch
    using physiologically plausible rules to give the model real signal.
    """
    rng = np.random.default_rng(seed)
    rows = []

    # -- Augment seed patients with noise
    for _ in range(n_augmented // len(SEED_PATIENTS)):
        for p in SEED_PATIENTS:
            age             = int(np.clip(p["age"] + rng.normal(0, 6), 18, 95))
            urgency         = int(np.clip(p["urgency"] + rng.choice([-1, 0, 0, 1]), 1, 5))
            days_since      = int(np.clip(p["days_since_visit"] + rng.normal(0, 7), 0, 180))
            cond_risk       = CONDITION_RISK_MAP.get(p["condition"], 50)
            base_risk       = p["risk_score"]
            risk_score      = float(np.clip(
                base_risk
                + rng.normal(0, 5)
                + (age - p["age"]) * 0.4
                + (urgency - p["urgency"]) * 4
                + (days_since - p["days_since_visit"]) * 0.15,
                0, 100
            ))
            priority_score  = 2 if risk_score >= 70 else (1 if risk_score >= 40 else 0)
            rows.append({
                "age":              age,
                "gender":           GENDER_MAP.get(p["gender"], 0),
                "condition_risk":   cond_risk + rng.normal(0, 3),
                "urgency":          urgency,
                "days_since_visit": days_since,
                "insurance_ord":    INSURANCE_MAP.get(p.get("insurance", "Aetna"), 2),
                "risk_score":       round(risk_score, 1),
                "priority":         priority_score,
            })

    # -- Generate fully random patients to broaden the distribution
    for _ in range(200):
        age         = int(rng.integers(18, 90))
        urgency     = int(rng.integers(1, 6))
        days_since  = int(rng.integers(0, 180))
        cond_risk   = float(rng.choice(list(CONDITION_RISK_MAP.values())))
        risk_score  = float(np.clip(
            cond_risk * 0.55
            + (age / 100) * 30
            + urgency * 5
            + (days_since / 180) * 15
            + rng.normal(0, 8),
            0, 100
        ))
        rows.append({
            "age":              age,
            "gender":           int(rng.integers(0, 2)),
            "condition_risk":   cond_risk,
            "urgency":          urgency,
            "days_since_visit": days_since,
            "insurance_ord":    int(rng.integers(0, 6)),
            "risk_score":       round(risk_score, 1),
            "priority":         2 if risk_score >= 70 else (1 if risk_score >= 40 else 0),
        })

    df = pd.DataFrame(rows)
    return df.sample(frac=1, random_state=seed).reset_index(drop=True)


FEATURE_COLS = ["age", "gender", "condition_risk", "urgency", "days_since_visit", "insurance_ord"]
