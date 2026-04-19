const KEY = "mediavoice_session_id";

/** Stable per-tab session id for audit logs (hospital-style traceability). */
export function getSessionId(): string {
  try {
    let s = sessionStorage.getItem(KEY);
    if (!s) {
      s = crypto.randomUUID();
      sessionStorage.setItem(KEY, s);
    }
    return s;
  } catch {
    return `session-${Date.now()}`;
  }
}
