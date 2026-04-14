"""
slot_recommender.py
ML-informed appointment slot recommender.

Uses outputs of risk + priority models to score every open slot and
return a ranked list. The scoring formula balances:
  - Patient urgency (direct weight)
  - Risk score (from ML model)
  - Slot time-of-day preference (morning preference for high-risk)
  - Days until slot (sooner = better for high-priority)
  - Doctor load (penalise slots where the doctor is overbooked)
"""
from __future__ import annotations
from typing import List, Dict, Any
from datetime import date, timedelta
import numpy as np

# ── Available slots for the current week ────────────────────────────────────
# In production this would come from Firestore / a calendar API.
BASE_SLOTS: List[Dict[str, Any]] = [
    {"slot_id": "S01", "day": "Monday",    "time": "9:00 AM",  "days_out": 0, "doctor": "Dr. Patel"},
    {"slot_id": "S02", "day": "Monday",    "time": "10:00 AM", "days_out": 0, "doctor": "Dr. Chen"},
    {"slot_id": "S03", "day": "Monday",    "time": "2:00 PM",  "days_out": 0, "doctor": "Dr. Reyes"},
    {"slot_id": "S04", "day": "Tuesday",   "time": "9:00 AM",  "days_out": 1, "doctor": "Dr. Vasquez"},
    {"slot_id": "S05", "day": "Tuesday",   "time": "11:00 AM", "days_out": 1, "doctor": "Dr. Patel"},
    {"slot_id": "S06", "day": "Tuesday",   "time": "3:00 PM",  "days_out": 1, "doctor": "Dr. Chen"},
    {"slot_id": "S07", "day": "Wednesday", "time": "9:00 AM",  "days_out": 2, "doctor": "Dr. Reyes"},
    {"slot_id": "S08", "day": "Wednesday", "time": "1:00 PM",  "days_out": 2, "doctor": "Dr. Patel"},
    {"slot_id": "S09", "day": "Thursday",  "time": "10:00 AM", "days_out": 3, "doctor": "Dr. Chen"},
    {"slot_id": "S10", "day": "Thursday",  "time": "2:00 PM",  "days_out": 3, "doctor": "Dr. Vasquez"},
    {"slot_id": "S11", "day": "Friday",    "time": "9:00 AM",  "days_out": 4, "doctor": "Dr. Reyes"},
    {"slot_id": "S12", "day": "Friday",    "time": "11:00 AM", "days_out": 4, "doctor": "Dr. Patel"},
]

# ── Doctor booking load (simulated — would query Firestore in production) ───
DOCTOR_LOAD: Dict[str, int] = {
    "Dr. Patel":   4,   # appointments already this week
    "Dr. Chen":    3,
    "Dr. Reyes":   5,
    "Dr. Vasquez": 2,
}
MAX_LOAD = 8  # max appointments per doctor per week


def _time_to_hour(t: str) -> float:
    """Convert '9:00 AM' → 9.0, '1:30 PM' → 13.5"""
    t = t.strip()
    h, rest = t.split(":")
    m_part, period = rest.split(" ")
    hour = int(h) + (12 if period == "PM" and int(h) != 12 else 0)
    return hour + int(m_part) / 60


def score_slots(
    risk_score: float,
    priority: str,
    urgency: int,
    preferred_doctor: str | None = None,
    language: str = "English",
) -> List[Dict[str, Any]]:
    """
    Score every available slot for a given patient profile.
    Returns a list of slots sorted by descending score (best first).
    """
    priority_weight = {"High": 3.0, "Medium": 2.0, "Low": 1.0}.get(priority, 1.5)
    scored = []

    for slot in BASE_SLOTS:
        hour       = _time_to_hour(slot["time"])
        days_out   = slot["days_out"]
        doctor     = slot["doctor"]
        load       = DOCTOR_LOAD.get(doctor, 0)

        # Component 1 — urgency drives the base score
        urgency_score = urgency * 12.0 * priority_weight          # 0–180

        # Component 2 — risk score contribution (normalised to 0–30)
        risk_contrib  = (risk_score / 100) * 30.0

        # Component 3 — prefer morning slots for high-risk patients
        if risk_score >= 70:
            time_pref = max(0, 14 - hour) * 2.5   # earlier the better
        else:
            time_pref = 10.0                        # neutral for low risk

        # Component 4 — prefer sooner slots (diminishing penalty)
        wait_penalty  = days_out * 5.0 * (priority_weight / 2)

        # Component 5 — doctor preference bonus
        doctor_bonus  = 15.0 if doctor == preferred_doctor else 0.0

        # Component 6 — doctor load penalty (avoid overbooked doctors)
        load_penalty  = max(0.0, (load / MAX_LOAD) * 20.0)

        # Component 7 — language flag (Dr. Vasquez for Spanish)
        lang_bonus    = 10.0 if language == "Spanish" and doctor == "Dr. Vasquez" else 0.0

        total_score = (
            urgency_score
            + risk_contrib
            + time_pref
            + doctor_bonus
            + lang_bonus
            - wait_penalty
            - load_penalty
        )

        scored.append({
            **slot,
            "score":           round(total_score, 2),
            "doctor_load":     f"{load}/{MAX_LOAD}",
            "reasoning": {
                "urgency_score": round(urgency_score, 1),
                "risk_contrib":  round(risk_contrib, 1),
                "time_pref":     round(time_pref, 1),
                "wait_penalty":  round(wait_penalty, 1),
                "doctor_bonus":  doctor_bonus,
                "lang_bonus":    lang_bonus,
            }
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored
