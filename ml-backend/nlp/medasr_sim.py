"""
Simulated MedASR: keyword / entity tagging for triage (no external APIs).
Flags medications, symptoms, and vitals patterns as high-priority clinical cues.
"""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

# Curated high-value clinical tokens (demo / CDS Connect alignment)
HIGH_PRIORITY_PATTERNS: List[Tuple[str, str]] = [
    (r"\bmetformin\b", "Medication: Metformin"),
    (r"\binsulin\b", "Medication: Insulin"),
    (r"\bwarfarin\b", "Medication: Warfarin"),
    (r"\btachycardia\b", "Finding: Tachycardia"),
    (r"\bbradycardia\b", "Finding: Bradycardia"),
    (r"\bchest\s+pain\b", "Symptom: Chest pain"),
    (r"\bsob\b|\bshortness\s+of\s+breath\b", "Symptom: Dyspnea"),
    (r"\bhypoxia\b|\bspo2\b|\boxygen\b", "Vitals: Oxygen / SpO2 concern"),
    (r"\bstroke\b|\btia\b", "Neuro: Stroke/TIA mention"),
    (r"\bsepsis\b|\bseptic\b", "Acuity: Sepsis concern"),
    (r"\bcopd\b|\bemphysema\b", "Condition: COPD"),
    (r"\bheart\s+failure\b|\bchf\b", "Condition: Heart failure"),
    (r"\bdiabetes\b", "Condition: Diabetes"),
    (r"\bhypertension\b|\bhtn\b", "Condition: Hypertension"),
]


def analyze_transcript(text: str | None) -> Dict[str, object]:
    """
    Returns entity hits, normalized labels, and whether any high-priority token matched.
    """
    if not text or not str(text).strip():
        return {
            "entity_hits": [],
            "labels": [],
            "high_priority": False,
            "token_count": 0,
        }

    lowered = text.lower()
    hits: List[str] = []
    labels: List[str] = []
    for pattern, label in HIGH_PRIORITY_PATTERNS:
        if re.search(pattern, lowered, re.I):
            m = re.search(pattern, lowered, re.I)
            if m:
                hits.append(m.group(0).strip())
            if label not in labels:
                labels.append(label)

    return {
        "entity_hits": list(dict.fromkeys(hits))[:20],
        "labels": labels[:15],
        "high_priority": len(labels) > 0,
        "token_count": len(lowered.split()),
    }
