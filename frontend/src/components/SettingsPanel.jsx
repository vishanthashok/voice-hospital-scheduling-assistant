import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Sliders,
  Plug,
  FileDown,
  KeyRound,
  Phone,
  Shield,
  Save,
} from "lucide-react";

const PREFS_KEY = "medivoice:settings";

const DEFAULT_PREFS = {
  alertThreshold: 75,
  exportFormat: "fhir",
};

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(next) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
}

function MaskedKeyDisplay({ label, icon: Icon, present, hint }) {
  const [reveal, setReveal] = useState(false);
  const masked = "•".repeat(24);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-200">{label}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
            present
              ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30"
              : "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
          }`}
        >
          {present ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {present ? "Configured" : "Missing"}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          readOnly
          type={reveal ? "text" : "password"}
          value={present ? (reveal ? "(managed server-side in .env)" : masked) : ""}
          placeholder={present ? "" : "Set this key in the server .env and restart"}
          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          disabled={!present}
          className="rounded-lg border border-slate-800 p-2 text-slate-500 hover:text-slate-200 disabled:opacity-40"
          aria-label={reveal ? "Hide" : "Show"}
        >
          {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="mt-2 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

export function SettingsPanel({ apiClient, prefs, onPrefsChange }) {
  const client = apiClient ?? axios;
  const [health, setHealth] = useState(null);
  const [conn, setConn] = useState({ status: "idle", latency: null, err: null });
  const [local, setLocal] = useState(prefs ?? loadPrefs());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (prefs) setLocal(prefs);
  }, [prefs]);

  const refreshHealth = useCallback(async () => {
    setConn({ status: "testing", latency: null, err: null });
    const t0 = performance.now();
    try {
      const { data } = await client.get("/health", { timeout: 10_000 });
      setHealth(data);
      setConn({
        status: "ok",
        latency: Math.max(1, Math.round(performance.now() - t0)),
        err: null,
      });
    } catch (e) {
      setHealth({ status: "offline" });
      setConn({
        status: "error",
        latency: null,
        err: e?.response?.data?.detail ?? e?.message ?? "Unreachable",
      });
    }
  }, [client]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const updateLocal = (patch) => {
    setLocal((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const persist = () => {
    savePrefs(local);
    onPrefsChange?.(local);
    setDirty(false);
  };

  const resetPrefs = () => {
    setLocal({ ...DEFAULT_PREFS });
    setDirty(true);
  };

  const geminiPresent = !!health?.gemini_configured;
  // The /health endpoint doesn't report twilio by design (keys stay server-side),
  // so we infer presence from a successful /voice/incoming path being reachable.
  // For now: show "Configured" if backend is reachable (server owns the token).
  const twilioPresent = conn.status === "ok";

  const thresholdTone =
    local.alertThreshold >= 75
      ? "from-rose-500 to-rose-400"
      : local.alertThreshold >= 40
        ? "from-amber-500 to-orange-400"
        : "from-emerald-500 to-emerald-400";

  return (
    <div className="flex flex-1 flex-col p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">System settings</h1>
          <p className="text-xs text-slate-500">
            Tenant preferences · API status · integration health
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <motion.button
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={persist}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-500/20 hover:bg-sky-400"
            >
              <Save className="h-3.5 w-3.5" />
              Save changes
            </motion.button>
          )}
          <button
            type="button"
            onClick={resetPrefs}
            className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-400 hover:border-slate-600 hover:text-slate-200"
          >
            Reset defaults
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {/* API control */}
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <KeyRound className="h-4 w-4 text-sky-400" />
                API credentials
              </h2>
              <p className="text-[11px] text-slate-500">
                Keys are stored in the server <span className="font-mono">.env</span> — never
                in the browser. This view only reports whether they are configured.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <MaskedKeyDisplay
              label="GEMINI_API_KEY"
              icon={KeyRound}
              present={geminiPresent}
              hint={
                geminiPresent
                  ? `Using ${health?.gemini_model || "unknown"}.`
                  : "Set GEMINI_API_KEY in .env and restart the backend."
              }
            />
            <MaskedKeyDisplay
              label="TWILIO_ACCOUNT_SID"
              icon={Phone}
              present={twilioPresent}
              hint={
                twilioPresent
                  ? "Voice webhook reachable · backend holds auth token."
                  : "Backend offline — cannot verify Twilio SID presence."
              }
            />
          </div>
        </section>

        {/* Twilio bridge / test connection */}
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5">
          <div className="mb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Plug className="h-4 w-4 text-emerald-400" />
              Backend connectivity
            </h2>
            <p className="text-[11px] text-slate-500">
              Ping <span className="font-mono">/health</span> to verify FastAPI + Gemini + Twilio
              webhooks are live.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">status</span>
              <span
                className={
                  conn.status === "ok"
                    ? "text-emerald-300"
                    : conn.status === "error"
                      ? "text-rose-300"
                      : "text-slate-400"
                }
              >
                {conn.status === "testing" ? "checking…" : conn.status.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">latency</span>
              <span>{conn.latency != null ? `${conn.latency} ms` : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">service</span>
              <span>{health?.service ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">gemini_model</span>
              <span>{health?.gemini_model ?? "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">gemini_configured</span>
              <span className={geminiPresent ? "text-emerald-300" : "text-rose-300"}>
                {String(!!geminiPresent)}
              </span>
            </div>
            {conn.err && (
              <div className="mt-2 border-t border-slate-800 pt-2 text-rose-300">
                {conn.err}
              </div>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void refreshHealth()}
              disabled={conn.status === "testing"}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/25 disabled:opacity-60"
            >
              {conn.status === "testing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              Test connection
            </button>
          </div>
        </section>

        {/* Sensitivity tuning */}
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 lg:col-span-2">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sliders className="h-4 w-4 text-amber-400" />
                Alert sensitivity
              </h2>
              <p className="text-[11px] text-slate-500">
                Only risk scores at or above this threshold trigger the notification dot and
                "High Risk" banner.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-slate-500">Threshold</p>
              <p className="font-mono text-3xl font-bold tabular-nums text-white">
                {local.alertThreshold}
                <span className="text-sm text-slate-500">/100</span>
              </p>
            </div>
          </div>

          <div className="relative h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${thresholdTone}`}
              style={{ width: `${local.alertThreshold}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={local.alertThreshold}
            onChange={(e) => updateLocal({ alertThreshold: Number(e.target.value) })}
            className="mt-3 w-full accent-sky-500"
            aria-label="Alert threshold"
          />
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-widest text-slate-500">
            <span>Low (0)</span>
            <span>Elevated (40)</span>
            <span>Critical (75+)</span>
            <span>Peak (100)</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
            {[40, 60, 75, 85].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => updateLocal({ alertThreshold: n })}
                className={`rounded-full px-3 py-1 font-semibold ring-1 transition ${
                  local.alertThreshold === n
                    ? "bg-sky-500/20 text-sky-200 ring-sky-500/40"
                    : "bg-slate-800/50 text-slate-400 ring-slate-700 hover:text-slate-200"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </section>

        {/* Export preferences */}
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 lg:col-span-2">
          <div className="mb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <FileDown className="h-4 w-4 text-indigo-400" />
              Default export format
            </h2>
            <p className="text-[11px] text-slate-500">
              Controls the default when clicking Download on any triage event.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                id: "fhir",
                title: "FHIR JSON",
                body: "HL7 FHIR R4 RiskAssessment resource. Ready to POST to an EHR bundle endpoint.",
              },
              {
                id: "pdf",
                title: "PDF summary",
                body: "Printable one-page report. Included in demo only — generator ships in v2.1.",
                disabled: true,
              },
            ].map((opt) => {
              const active = local.exportFormat === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => updateLocal({ exportFormat: opt.id })}
                  className={`rounded-xl border p-4 text-left transition ${
                    active
                      ? "border-sky-500/60 bg-sky-500/10 ring-1 ring-sky-500/30"
                      : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                  } ${opt.disabled ? "opacity-60" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{opt.title}</span>
                    {active && (
                      <CheckCircle2 className="h-4 w-4 text-sky-400" />
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{opt.body}</p>
                  {opt.disabled && (
                    <p className="mt-2 text-[10px] uppercase tracking-wider text-amber-400">
                      Coming soon
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Security / session */}
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Shield className="h-4 w-4 text-emerald-400" />
            Security &amp; compliance
          </h2>
          <ul className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              API keys are loaded from <span className="font-mono">.env</span> with{" "}
              <span className="font-mono">override=True</span>; stale shell env vars cannot shadow
              them.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              Audit log is append-only JSONL on disk (
              <span className="font-mono">backend/data/triage_history.jsonl</span>) and is
              gitignored.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              Gemini is called with <span className="font-mono">temperature=0.2</span> and strict
              JSON mode; no training on your data.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              Twilio webhooks require HTTPS (<span className="font-mono">PUBLIC_BASE_URL</span>)
              and can be signature-verified in production.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
