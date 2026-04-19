"""
CDS Connect–inspired deterministic recommendations (no external CDS APIs).
Maps condition + risk band + optional MedASR flags to actionable clinical suggestions.
"""
from __future__ import annotations

from typing import List


def clinical_recommendations(
    *,
    condition: str,
    risk_score: float,
    risk_band: str,
    medasr_high_priority: bool,
    medasr_labels: List[str],
) -> List[str]:
    out: List[str] = []
    c = (condition or "").lower()
    rs = float(risk_score)

    if "copd" in c or "emphysema" in c:
        if rs >= 75 or risk_band in ("High", "Critical"):
            out.append("Patient with COPD and elevated risk: obtain SpO2 and assess for exacerbation per COPD protocol.")
        else:
            out.append("COPD on record: confirm inhaler technique and vaccination status at next visit.")

    if "heart" in c or "chf" in c or "failure" in c:
        if rs >= 70:
            out.append("Heart failure context with elevated risk: follow HF protocol — daily weights and fluid review.")
        else:
            out.append("Document NYHA class if not recent; review ACE/ARB/ARNI and beta-blocker tolerability.")

    if "diabetes" in c:
        out.append("Diabetes: verify recent A1c and foot exam per ADA primary-care checklist.")

    if "hypertension" in c or "bp" in c or "pressure" in c:
        if rs >= 65:
            out.append("Hypertension with higher composite risk: confirm home BP log and medication adherence today.")

    if medasr_high_priority:
        out.append("Voice transcript contains high-priority clinical entities — prioritize medication reconciliation.")

    if any("tachycardia" in x.lower() for x in medasr_labels) or "tachycardia" in c:
        out.append("Tachycardia mentioned: consider ECG and volume status assessment if acute symptoms.")

    if any("metformin" in x.lower() for x in medasr_labels):
        out.append("Metformin mentioned: screen renal function if acute illness or contrast planned.")

    if any("oxygen" in x.lower() or "spo2" in x.lower() or "hypoxia" in x.lower() for x in medasr_labels):
        out.append("Oxygenation concern in transcript: obtain vital signs including SpO2.")

    if risk_band == "Critical" or rs >= 85:
        out.append("Critical risk stratification: expedite provider review and consider escalation pathway.")

    if not out:
        out.append("Continue routine triage: standard nursing assessment and disposition per clinic policy.")

    # Dedupe preserve order
    seen = set()
    uniq: List[str] = []
    for line in out:
        if line not in seen:
            seen.add(line)
            uniq.append(line)
    return uniq[:8]
