const jsonHeaders = { "Content-Type": "application/json" };

/** Matches `PatientRecord` in App — duplicated to avoid circular imports */
export type PatientPayload = {
  id: string;
  name: string;
  age: number;
  gender: string;
  condition: string;
  priority: string;
  insurance: string;
  language: string;
  doctor: string;
  lastVisit: string;
};

export interface RiskWithShap {
  risk_score: number;
  risk_band: string;
  clinical_rationale: Record<string, string>;
  top_shap_contributions: Array<{
    feature: string;
    shap_value: number;
    direction: string;
  }>;
}

export async function fetchRiskWithShap(p: PatientPayload, daysSince: number): Promise<RiskWithShap> {
  const urgency = p.priority === "High" ? 4 : p.priority === "Medium" ? 3 : 2;
  const r = await fetch("/api/ml/predict/risk", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      age: p.age,
      gender: p.gender,
      condition: p.condition,
      urgency,
      days_since_visit: daysSince,
      insurance: p.insurance,
      language: p.language,
      preferred_doctor: p.doctor,
    }),
  });
  if (!r.ok) throw new Error(`Risk API ${r.status}`);
  return r.json();
}

export async function fetchSlotRecommend(p: PatientPayload, daysSince: number) {
  const urgency = p.priority === "High" ? 4 : p.priority === "Medium" ? 3 : 2;
  const r = await fetch("/api/ml/recommend/slot", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      age: p.age,
      gender: p.gender,
      condition: p.condition,
      urgency,
      days_since_visit: daysSince,
      insurance: p.insurance,
      language: p.language,
      preferred_doctor: p.doctor,
    }),
  });
  if (!r.ok) throw new Error(`Slot API ${r.status}`);
  return r.json() as Promise<{
    top_slots: Array<Record<string, unknown>>;
    patient_summary: Record<string, unknown>;
  }>;
}

export async function fetchFhirRiskAssessment(p: PatientPayload, daysSince: number) {
  const urgency = p.priority === "High" ? 4 : p.priority === "Medium" ? 3 : 2;
  const r = await fetch("/api/ml/interop/fhir/RiskAssessment", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      patient: {
        age: p.age,
        gender: p.gender,
        condition: p.condition,
        urgency,
        days_since_visit: daysSince,
        insurance: p.insurance,
        language: p.language,
        preferred_doctor: p.doctor,
      },
      patient_reference: `Patient/${p.id}`,
      assessment_id: `medivoice-${p.id}`,
    }),
  });
  if (!r.ok) throw new Error(`FHIR API ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/fhir+json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
