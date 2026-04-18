import { getMlBackendOrigin } from "./mlApi";

const jsonHeaders = { "Content-Type": "application/json" };

function apiBase(): string {
  const configured = import.meta.env.VITE_SCHEDULING_API_URL as string | undefined;
  if (configured?.trim()) {
    return configured.trim().replace(/\/$/, "");
  }
  const mlOrigin = getMlBackendOrigin();
  if (mlOrigin) {
    return mlOrigin;
  }
  return "http://localhost:8001";
}

export function schedulingUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${normalized}`;
}

export async function fetchSchedulingMetrics() {
  const response = await fetch(schedulingUrl("/metrics"));
  if (!response.ok) throw new Error(`Metrics API ${response.status}`);
  return response.json() as Promise<{
    total_requests: number;
    successful_bookings: number;
    failed_attempts: number;
    avg_response_time: number;
  }>;
}

export async function scheduleFromText(payload: { text: string; session_id: string; patient_email: string }) {
  const response = await fetch(schedulingUrl("/schedule-from-text"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Scheduling API ${response.status}: ${message}`);
  }
  return response.json();
}
