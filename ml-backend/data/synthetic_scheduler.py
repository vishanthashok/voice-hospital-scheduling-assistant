"""
MedScheduler: 100+ synthetic outpatient records for clinic-load demos (deterministic, local).
"""
from __future__ import annotations

import hashlib
from typing import Any, Dict, List

from data.seed_patients import CONDITION_LIST, SEED_PATIENTS

FIRST = (
    "Alex",
    "Jordan",
    "Taylor",
    "Morgan",
    "Riley",
    "Casey",
    "Quinn",
    "Avery",
    "Skyler",
    "Reese",
)
LAST = (
    "Nguyen",
    "Patel",
    "Garcia",
    "Kim",
    "Hassan",
    "Okafor",
    "Silva",
    "Park",
    "Ibrahim",
    "Chen",
    "Murphy",
    "Singh",
)

STATUSES = ("Scheduled", "In Call Queue", "Needs Follow-up", "Completed", "Missed")
DOCS = ("Dr. Patel", "Dr. Chen", "Dr. Reyes", "Dr. Vasquez")
INS = ("Aetna", "Cigna", "Medicare", "Medicaid", "Blue Cross", "UnitedHealth")


def _rng(i: int) -> int:
    h = hashlib.sha256(str(i).encode()).digest()
    return int.from_bytes(h[:4], "big")


def generate_synthetic_patients(n: int = 120) -> List[Dict[str, Any]]:
    """Return `n` patient dicts aligned with the React `PatientRecord` shape (camelCase keys)."""
    out: List[Dict[str, Any]] = []
    for p in SEED_PATIENTS:
        out.append(_seed_to_frontend(p))

    target = max(n, len(out))
    syn_i = 0
    while len(out) < target:
        r = _rng(syn_i + 10_000)
        age = 22 + (r % 73)
        cond = CONDITION_LIST[r % len(CONDITION_LIST)]
        pri = ("Low", "Medium", "High")[r % 3]
        try:
            ci = CONDITION_LIST.index(cond)
        except ValueError:
            ci = 5
        risk = max(8, min(95, ci * 9 + (r % 40)))
        entry = "voice" if r % 3 != 0 else "manual"
        syn_i += 1
        pid = f"S{syn_i:03d}"
        fn = FIRST[r % len(FIRST)]
        ln = LAST[r % len(LAST)]
        transcript = _demo_transcript(cond, r)
        out.append(
            {
                "id": pid,
                "name": f"{fn} {ln}",
                "age": age,
                "gender": "F" if r % 2 == 0 else "M",
                "condition": cond,
                "priority": pri,
                "phone": f"512555{r % 10000:04d}",
                "language": "Spanish" if r % 7 == 0 else "English",
                "status": STATUSES[r % len(STATUSES)],
                "insurance": INS[r % len(INS)],
                "lastVisit": f"2026-{(1 + r % 3):02d}-{(1 + r % 26):02d}",
                "riskScore": risk,
                "doctor": DOCS[r % len(DOCS)],
                "callNotes": transcript,
                "entrySource": entry,
            }
        )
    return out[:n]


def _seed_to_frontend(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": p["id"],
        "name": p["name"],
        "age": p["age"],
        "gender": p["gender"],
        "condition": p["condition"],
        "priority": p["priority"],
        "phone": "2105550100",
        "language": "English",
        "status": "In Call Queue" if p["id"] in ("P006", "P011") else "Scheduled",
        "insurance": p["insurance"],
        "lastVisit": "2026-03-28",
        "riskScore": p["risk_score"],
        "doctor": "Dr. Patel",
        "callNotes": f"Triage note for {p['name']}: {p['condition']}. Patient mentions home medications including Metformin when applicable.",
        "entrySource": "voice",
    }


def _demo_transcript(condition: str, r: int) -> str:
    snippets = [
        f"I have been having shortness of breath and use my inhaler. My {condition} has been worse.",
        "They started me on Metformin last month. I feel tachycardic when I walk upstairs.",
        "Chest pain started yesterday, mild. Oxygen at home reads okay but I am worried.",
    ]
    return snippets[r % len(snippets)]
