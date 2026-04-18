"""
slot_recommender.py
Appointment slot selection as a constraint satisfaction problem (OR-Tools CP-SAT).

Objective (Outcomes): minimize Patient_Wait_Time * Risk_Score for the chosen slot.

Constraints:
  - Provider burnout: at most 3 *high-risk* patients already booked into the same
    2-hour calendar window (simulated occupancy table).
  - Critical band (risk ≥80): same objective naturally prefers earliest feasible slots
    because risk is high; we add a small wait-penalty tie-break for clarity.

Doctor preference / language remain light tie-breakers (do not dominate the clinical objective).
"""
from __future__ import annotations

from typing import Any, Dict, List

from ortools.sat.python import cp_model

# ── Available slots for the current week ────────────────────────────────────
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

DOCTOR_LOAD: Dict[str, int] = {
    "Dr. Patel":   4,
    "Dr. Chen":    3,
    "Dr. Reyes":   5,
    "Dr. Vasquez": 2,
}
MAX_LOAD = 8

# High-risk threshold for burnout counting (aligns with triage "High" band lower bound)
HIGH_RISK_THRESHOLD = 60.0

# Simulated high-risk patients already booked per 2-hour window (demo schedule load)
EXISTING_HIGH_RISK_PER_WINDOW: Dict[str, int] = {
    "Monday|08": 2,
    "Monday|10": 1,
    "Monday|14": 2,
    "Tuesday|08": 3,  # at cap — new high-risk patient cannot land here
    "Tuesday|10": 1,
    "Tuesday|14": 2,
    "Wednesday|08": 0,
    "Wednesday|12": 2,
    "Thursday|10": 1,
    "Thursday|14": 3,
    "Friday|08": 1,
    "Friday|10": 2,
}


def _time_to_hour(t: str) -> float:
    t = t.strip()
    h, rest = t.split(":")
    m_part, period = rest.split(" ")
    hour = int(h) + (12 if period == "PM" and int(h) != 12 else 0)
    return hour + int(m_part) / 60


def _window_key(day: str, time: str) -> str:
    hour = _time_to_hour(time)
    start = int(hour) // 2 * 2
    return f"{day}|{start:02d}"


def _wait_hours(slot: Dict[str, Any]) -> float:
    """Scalar wait proxy: day offset + intraday hour (larger = later)."""
    return float(slot["days_out"]) * 24.0 + _time_to_hour(slot["time"])


def _base_cost(
    wait_h: float,
    risk_score: float,
    risk_band: str,
) -> float:
    """
    Primary objective: minimize wait_hours * risk_score.
    Critical patients get an extra wait multiplier so earliest feasible slots dominate
    when burnout blocks the very first options.
    """
    r = max(float(risk_score), 1.0)
    if risk_band == "Critical":
        # Strengthen sensitivity to waiting without changing the core product formulation
        r = r * 1.15
    return wait_h * r


def _tie_break_cost(
    slot: Dict[str, Any],
    preferred_doctor: str | None,
    language: str,
) -> float:
    """Tiny secondary cost (<< clinical objective) for UX parity with the old heuristic."""
    doctor = slot["doctor"]
    load = DOCTOR_LOAD.get(doctor, 0)
    load_penalty = max(0.0, (load / MAX_LOAD)) * 2.0
    doctor_bonus = -1.5 if preferred_doctor and doctor == preferred_doctor else 0.0
    lang_bonus = -1.0 if language == "Spanish" and doctor == "Dr. Vasquez" else 0.0
    return load_penalty + doctor_bonus + lang_bonus


def _scaled_integer_cost(x: float) -> int:
    return int(round(x * 1000.0))


def score_slots(
    risk_score: float,
    priority: str,
    urgency: int,
    preferred_doctor: str | None = None,
    language: str = "English",
    risk_band: str = "Low",
) -> List[Dict[str, Any]]:
    """
    OR-Tools CP-SAT: pick up to 3 slots with smallest combined clinical cost while respecting
    burnout caps for high-risk patients. Returns the legacy enriched slot dicts (best first).
    """
    patient_high_risk = float(risk_score) >= HIGH_RISK_THRESHOLD

    meta: List[Dict[str, Any]] = []
    for slot in BASE_SLOTS:
        wk = _window_key(slot["day"], slot["time"])
        wh = _wait_hours(slot)
        base = _base_cost(wh, float(risk_score), risk_band)
        tie = _tie_break_cost(slot, preferred_doctor, language)
        total = base + tie * 0.05  # keep tie-break subordinate
        cap_ok = (not patient_high_risk) or (EXISTING_HIGH_RISK_PER_WINDOW.get(wk, 0) < 3)
        meta.append(
            {
                "slot": slot,
                "window_key": wk,
                "wait_hours": wh,
                "base_cost": base,
                "tie_cost": tie,
                "total_cost": total,
                "cap_ok": cap_ok,
            }
        )

    feasible_idx = [i for i, m in enumerate(meta) if m["cap_ok"]]
    if not feasible_idx:
        # Demo fallback: ignore burnout if the schedule is over-constrained
        feasible_idx = list(range(len(meta)))

    chosen: List[int] = []
    banned: set[int] = set()
    for _ in range(3):
        cand = [i for i in feasible_idx if i not in banned]
        if not cand:
            break
        model = cp_model.CpModel()
        x = {i: model.NewBoolVar(f"x_{i}") for i in cand}
        model.Add(sum(x.values()) == 1)
        model.Minimize(
            sum(x[i] * _scaled_integer_cost(meta[i]["total_cost"]) for i in cand)
        )
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 2.0
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break
        best = next(i for i in cand if solver.Value(x[i]) == 1)
        chosen.append(best)
        banned.add(best)

    out: List[Dict[str, Any]] = []
    for rank, idx in enumerate(chosen):
        m = meta[idx]
        slot = m["slot"]
        doctor = slot["doctor"]
        load = DOCTOR_LOAD.get(doctor, 0)
        raw_cost = m["total_cost"]
        display_score = round(max(0.0, 800.0 - raw_cost * 1.25), 2)

        out.append(
            {
                **slot,
                "score": display_score,
                "doctor_load": f"{load}/{MAX_LOAD}",
                "reasoning": {
                    "ortools_rank": rank + 1,
                    "cp_sat_status": "OPTIMAL/FEASIBLE",
                    "objective_wait_hours": round(m["wait_hours"], 3),
                    "objective_base_cost": round(m["base_cost"], 4),
                    "objective_total_cost": round(raw_cost, 4),
                    "tie_break": round(m["tie_cost"], 4),
                    "window_key": m["window_key"],
                    "existing_high_risk_in_window": EXISTING_HIGH_RISK_PER_WINDOW.get(
                        m["window_key"], 0
                    ),
                    "patient_counts_as_high_risk": patient_high_risk,
                    "burnout_cap": 3,
                    "priority": priority,
                    "urgency": urgency,
                },
            }
        )

    return out
