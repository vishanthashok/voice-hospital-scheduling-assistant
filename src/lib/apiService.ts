import { getSessionId } from "./sessionId";

export { getSessionId };

const jsonHeaders = { "Content-Type": "application/json" };

/**
 * Abort after `timeoutMs` so `fetch` cannot hang forever (critical when `AbortSignal.timeout` is missing).
 * Uses AbortController — works in all modern browsers.
 */
function mlPostSignal(timeoutMs = 120_000): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), timeoutMs);
  return c.signal;
}

/**
 * User cancel OR wall-clock timeout — whichever fires first.
 * Does not rely on `AbortSignal.any` (so timeouts always apply in older browsers).
 */
function mergeUserAndTimeout(user?: AbortSignal, timeoutMs = 55_000): AbortSignal {
  const c = new AbortController();
  let tid: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    tid = undefined;
    if (user) user.removeEventListener("abort", onUser);
    c.abort();
  }, timeoutMs);

  const clearTimer = () => {
    if (tid !== undefined) {
      clearTimeout(tid);
      tid = undefined;
    }
  };

  const onUser = () => {
    clearTimer();
    c.abort();
  };

  if (user) {
    if (user.aborted) {
      clearTimer();
      c.abort();
      return c.signal;
    }
    user.addEventListener("abort", onUser, { once: true });
  }

  return c.signal;
}

/**
 * MediVoice ML — single base URL for all FastAPI calls.
 *
 * Priority:
 * 1. `VITE_ML_BACKEND_URL` — e.g. `https://your-ml.onrender.com` (no trailing slash)
 * 2. Otherwise same-origin `/api/ml/...` (Express proxy → `ML_BACKEND_URL` in server.ts / `.env`)
 *
 * In dev we use the proxy (not direct :8000) so the browser always hits the same ML process as
 * `npm run dev:ml` / `.env` — avoids 404 when an old uvicorn is still bound to 8000.
 */
export function getMlBaseUrl(): string {
  const v = import.meta.env.VITE_ML_BACKEND_URL as string | undefined;
  if (v?.trim()) return v.trim().replace(/\/$/, "");
  return "";
}

/** Resolved origin only (no path). Empty string means “use `/api/ml` proxy”. */
export function getMlBackendOrigin(): string {
  return getMlBaseUrl();
}

export function mlUrl(path: string): string {
  const base = getMlBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  if (base) return `${base}${p}`;
  return `/api/ml${p}`;
}

/** MediVoice 2.0 Gemini orchestrator — matches FastAPI `TriageAnalyzeOut`. */
export type ClinicalTriageResponse = {
  risk_score: number;
  risk_band: string;
  priority_level: string;
  priority_label: string;
  clinical_rationale: string;
  top_drivers: Array<{
    factor: string;
    weight: number;
    direction: string;
    note: string;
  }>;
  fhir_risk_assessment: Record<string, unknown>;
  source: string;
};

export async function analyzeClinicalTriage(
  payload: {
    patient_id?: string | null;
    patient_name: string;
    age: number;
    gender: string;
    condition: string;
    voice_transcript: string;
    session_id?: string | null;
  },
  options?: { signal?: AbortSignal }
): Promise<ClinicalTriageResponse> {
  const r = await fetch(mlUrl("/triage/analyze"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
    signal: mergeUserAndTimeout(options?.signal, 55_000),
  });
  if (!r.ok) throw new Error(`Triage analyze ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json() as Promise<ClinicalTriageResponse>;
}

/** GET /health — probe for ML API (retries help when the UI loads before uvicorn finishes binding). */
export async function fetchMlHealth(): Promise<{ ok: boolean; status: number }> {
  const attempts = 10;
  const delayMs = 400;
  const perAttemptMs = 5000;

  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(mlUrl("/health"), {
        method: "GET",
        signal: mlPostSignal(perAttemptMs),
      });
      if (r.ok) return { ok: true, status: r.status };
    } catch {
      /* connection refused / proxy not ready — retry */
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ok: false, status: 0 };
}

/** GET /model/info + /health — for System Diagnostics (open-source only). */
export async function fetchModelDiagnostics(): Promise<{
  health: unknown;
  modelInfo: unknown;
}> {
  const [hr, mr] = await Promise.all([
    fetch(mlUrl("/health")),
    fetch(mlUrl("/model/info")),
  ]);
  const health = hr.ok ? await hr.json() : { error: hr.status };
  const modelInfo = mr.ok ? await mr.json() : { error: mr.status };
  return { health, modelInfo };
}

/** Parse JSON error from ML API or Express proxy (503 bodies include hint + target). */
async function readMlErrorBody(r: Response): Promise<string> {
  const text = await r.text();
  try {
    const j = JSON.parse(text) as {
      detail?: string;
      error?: string;
      hint?: string;
      target?: string;
    };
    const parts = [
      j.error,
      j.detail || undefined,
      j.hint,
      j.target ? `proxy target: ${j.target}` : undefined,
    ].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  } catch {
    /* not JSON */
  }
  return text.slice(0, 400) || r.statusText;
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
  callNotes?: string;
  entrySource?: "voice" | "manual";
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
  clinical_recommendations?: string[];
  medasr_entity_hits?: string[];
  medasr_high_priority?: boolean;
}

export interface PriorityResult {
  priority: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/** Core ML feature vector + audit ids (logged on `/predict/risk`). */
export function patientFeaturesPayload(p: PatientPayload, daysSince: number) {
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
    patient_id: p.id,
    session_id: getSessionId(),
    voice_transcript: p.callNotes ?? "",
    entry_source: p.entrySource ?? "voice",
  };
}

export async function fetchRiskWithShap(p: PatientPayload, daysSince: number): Promise<RiskWithShap> {
  const r = await fetch(mlUrl("/predict/risk"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(patientFeaturesPayload(p, daysSince)),
    signal: mlPostSignal(),
  });
  if (!r.ok) throw new Error(`Risk API ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json();
}

export async function fetchPriority(p: PatientPayload, daysSince: number): Promise<PriorityResult> {
  const r = await fetch(mlUrl("/predict/priority"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(patientFeaturesPayload(p, daysSince)),
    signal: mlPostSignal(),
  });
  if (!r.ok) throw new Error(`Priority API ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json();
}

export async function fetchSlotRecommend(
  p: PatientPayload,
  daysSince: number,
  options?: { signal?: AbortSignal }
) {
  const r = await fetch(mlUrl("/recommend/slot"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(patientFeaturesPayload(p, daysSince)),
    signal: mergeUserAndTimeout(options?.signal, 120_000),
  });
  if (!r.ok) throw new Error(`Slot API ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json() as Promise<{
    top_slots: Array<Record<string, unknown>>;
    patient_summary: Record<string, unknown>;
  }>;
}

/** Single backend round-trip: one Gemini/cache triage + risk + priority + slots (preferred for Triage Desk). */
export async function fetchTriageRefresh(p: PatientPayload, daysSince: number): Promise<{
  risk: RiskWithShap;
  priority: PriorityResult;
  slots: {
    top_slots: Array<Record<string, unknown>>;
    patient_summary: Record<string, unknown>;
  };
}> {
  const r = await fetch(mlUrl("/predict/triage_refresh"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(patientFeaturesPayload(p, daysSince)),
    signal: mlPostSignal(180_000),
  });
  if (!r.ok) throw new Error(`Triage refresh ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json() as Promise<{
    risk: RiskWithShap;
    priority: PriorityResult;
    slots: {
      top_slots: Array<Record<string, unknown>>;
      patient_summary: Record<string, unknown>;
    };
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
  if (!r.ok) throw new Error(`FHIR API ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json() as Promise<Record<string, unknown>>;
}

/**
 * FHIR download: response as Blob → object URL → save as JSON
 * (avoids treating the bundle as plain text).
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
  if (!r.ok) throw new Error(`FHIR ${r.status}: ${await readMlErrorBody(r)}`);
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
  if (!r.ok) throw new Error(`Retrain ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json();
}

/** Persist Patient + Observation + RiskAssessment bundle under `data/fhir_records/`. */
export async function savePatientFhirBundle(
  p: PatientPayload,
  daysSince: number,
  risk: RiskWithShap,
  priority: PriorityResult
): Promise<{ status: string; paths?: { latest: string; archive: string } }> {
  const r = await fetch(mlUrl("/save/patient"), {
    method: "POST",
    headers: jsonHeaders,
    signal: mlPostSignal(60_000),
    body: JSON.stringify({
      patient_id: p.id,
      patient_name: p.name,
      gender: p.gender,
      session_id: getSessionId(),
      features: patientFeaturesPayload(p, daysSince),
      risk,
      priority,
    }),
  });
  if (!r.ok) throw new Error(`Save bundle ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json() as Promise<{ status: string; paths?: { latest: string; archive: string } }>;
}

export async function fetchLatestFhirBundleJson(patientId: string): Promise<Record<string, unknown>> {
  const r = await fetch(mlUrl(`/fhir/bundle/latest/${encodeURIComponent(patientId)}`), {
    method: "GET",
  });
  if (!r.ok) throw new Error(`FHIR bundle ${r.status}: ${await readMlErrorBody(r)}`);
  return r.json() as Promise<Record<string, unknown>>;
}

/**
 * Download the **persisted** FHIR Bundle (verified record), not a one-off live RiskAssessment.
 */
export async function downloadPersistedFhirBundle(p: PatientPayload): Promise<void> {
  const r = await fetch(mlUrl(`/fhir/bundle/latest/${encodeURIComponent(p.id)}`), { method: "GET" });
  if (!r.ok) throw new Error(`FHIR bundle ${r.status}: ${await readMlErrorBody(r)}`);
  const blob = await r.blob();
  const safe = p.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "Patient";
  const filename = `FHIR_Bundle_${safe}_${p.id}.json`;
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

export async function postAuditEvent(action: string, patientId?: string, detail?: string): Promise<void> {
  try {
    await fetch(mlUrl("/audit/event"), {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        session_id: getSessionId(),
        action,
        patient_id: patientId ?? null,
        detail: detail ?? null,
      }),
    });
  } catch {
    /* non-fatal */
  }
}

/** Full FHIR Bundle: Patient + RiskAssessment + Communication (transcript). */
export async function downloadExportFhirBundle(
  p: PatientPayload,
  risk: RiskWithShap,
  priority: PriorityResult
): Promise<void> {
  const r = await fetch(mlUrl("/export/fhir"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      patient_id: p.id,
      patient_name: p.name,
      gender: p.gender,
      voice_transcript: p.callNotes ?? "",
      session_id: getSessionId(),
      risk,
      priority,
    }),
  });
  if (!r.ok) throw new Error(`Export FHIR ${r.status}: ${await readMlErrorBody(r)}`);
  const blob = await r.blob();
  const safe = p.name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 80) || "Patient";
  const filename = `FHIR_Export_Bundle_${safe}_${p.id}.json`;
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
