const jsonHeaders = { "Content-Type": "application/json" };

/**
 * When `VITE_ML_BACKEND_URL` is set (e.g. https://medivoice-ml.onrender.com), all ML calls
 * go there directly (required for separate Render web + ML services).
 * When unset, paths use `/api/ml/...` so the local Express server can proxy to port 8000.
 */
export function getMlBackendOrigin(): string {
  const v = import.meta.env.VITE_ML_BACKEND_URL as string | undefined;
  if (!v?.trim()) return "";
  return v.trim().replace(/\/$/, "");
}

export function mlUrl(path: string): string {
  const base = getMlBackendOrigin();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (base) return `${base}${p}`;
  return `/api/ml${p}`;
}

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

function patientBody(p: PatientPayload, daysSince: number) {
  const urgency = p.priority === "High" ? 4 : p.priority === "Medium" ? 3 : 2;
  return {
    age: p.age,
    gender: p.gender,
    condition: p.condition,
    urgency,
    days_since_visit: daysSince,
    insurance: p.insurance,
    language: p.language,
    preferred_doctor: p.doctor,
  };
}

export async function fetchRiskWithShap(p: PatientPayload, daysSince: number): Promise<RiskWithShap> {
  const r = await fetch(mlUrl("/predict/risk"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(patientBody(p, daysSince)),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Risk API ${r.status}${t ? `: ${t.slice(0, 120)}` : ""}`);
  }
  return r.json();
}

export async function fetchSlotRecommend(p: PatientPayload, daysSince: number) {
  const r = await fetch(mlUrl("/recommend/slot"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(patientBody(p, daysSince)),
  });
  if (!r.ok) throw new Error(`Slot API ${r.status}`);
  return r.json() as Promise<{
    top_slots: Array<Record<string, unknown>>;
    patient_summary: Record<string, unknown>;
  }>;
}

/** POST FHIR; returns JSON object (for inline use) */
export async function fetchFhirRiskAssessment(p: PatientPayload, daysSince: number) {
  const urgency = p.priority === "High" ? 4 : p.priority === "Medium" ? 3 : 2;
  const r = await fetch(mlUrl("/interop/fhir/RiskAssessment"), {
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

/**
 * Robust download: response as Blob → object URL → triggers save as
 * FHIR_Risk_Assessment_[PatientName].json
 */
export async function handleDownloadFHIR(p: PatientPayload, daysSince: number): Promise<void> {
  const urgency = p.priority === "High" ? 4 : p.priority === "Medium" ? 3 : 2;
  const url = mlUrl("/interop/fhir/RiskAssessment");
  const r = await fetch(url, {
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
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`FHIR ${r.status}${t ? `: ${t.slice(0, 200)}` : ""}`);
  }
  const blob = await r.blob();
  const safe = p.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "Patient";
  const filename = `FHIR_Risk_Assessment_${safe}.json`;
  const href = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(href);
  }
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/fhir+json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(href);
}

/** GET /model/retrain — can take 30–60s on cold Render free tier */
export async function fetchRetrainModels(signal?: AbortSignal): Promise<unknown> {
  const r = await fetch(mlUrl("/model/retrain"), { method: "GET", signal });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Retrain ${r.status}${t ? `: ${t.slice(0, 120)}` : ""}`);
  }
  return r.json();
}
