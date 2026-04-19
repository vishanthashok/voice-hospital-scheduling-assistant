import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { LiveCallVisualizer } from "./components/LiveCallVisualizer";
import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Download,
  Flame,
  Loader2,
  Search,
  Settings,
  Stethoscope,
  Wifi,
  Sparkles,
  Mic,
} from "lucide-react";

/** Dev: Vite proxies /triage, /export, /health → FastAPI. Prod: set `VITE_API_BASE`. */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const client = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 120_000,
});

const MOCK_PATIENTS = [
  {
    id: "P001",
    name: "Jordan Ellis",
    transcript:
      "I've had tightness in my chest since this morning and some shortness of breath when I walk upstairs.",
    live: true,
    minutesAgo: 4,
  },
  {
    id: "P002",
    name: "Sam Rivera",
    transcript:
      "Routine follow-up for hypertension; meds are fine, just need a refill and vitals check.",
    live: false,
    minutesAgo: 18,
  },
  {
    id: "P003",
    name: "Taylor Chen",
    transcript:
      "Fever 101 for two days, sore throat, worse when swallowing. No trouble breathing.",
    live: true,
    minutesAgo: 2,
  },
  {
    id: "P004",
    name: "Morgan Blake",
    transcript:
      "Chronic back pain flared after lifting; pain is sharp but I can still move my legs fine.",
    live: false,
    minutesAgo: 52,
  },
  {
    id: "P005",
    name: "Riley Park",
    transcript:
      "Anxiety and palpitations after coffee; feels like heart racing but no chest pain.",
    live: false,
    minutesAgo: 31,
  },
];

const HEAT_ROWS = ["9a", "10a", "11a", "1p", "2p", "3p"];
const HEAT_COLS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function hashLoad(seed, r, c) {
  let x = seed + r * 17 + c * 31;
  x = (x * 1103515245 + 12345) & 0x7fffffff;
  return x % 101;
}

/** Emerald → rose blend by intensity 0–100 */
function heatCellStyle(v) {
  const t = v / 100;
  const e = [16, 185, 129];
  const r = [244, 63, 94];
  const rgb = e.map((c, i) => Math.round(c + (r[i] - c) * t));
  return { backgroundColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` };
}

function suggestedSlots(riskScore) {
  const base = [
    { day: "Tuesday", time: "10:30 AM", doctor: "Dr. Patel", room: "Suite 3B" },
    { day: "Wednesday", time: "2:00 PM", doctor: "Dr. Vasquez", room: "Telehealth" },
    { day: "Friday", time: "9:00 AM", doctor: "Dr. Chen", room: "Clinic A" },
  ];
  const urgency = riskScore >= 70 ? "Earliest feasible window" : "Balanced wait · CP-SAT";
  return base.map((s, i) => ({
    ...s,
    subtitle: `${urgency} · rank ${i + 1}`,
  }));
}

function formatCalled(mins) {
  if (mins < 1) return "Just now";
  if (mins < 60) return `Called ${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `Called ${h}h ago`;
}

/** Risk color mapping — Red 75+, Orange 40-74, Green <40. */
function riskTone(score) {
  if (score == null || Number.isNaN(score)) {
    return {
      text: "text-slate-400",
      bg: "bg-slate-800/60",
      ring: "ring-slate-700",
      bar: "from-slate-500 to-slate-400",
      label: "PENDING",
    };
  }
  if (score >= 75) {
    return {
      text: "text-rose-300",
      bg: "bg-rose-500/15",
      ring: "ring-rose-500/40",
      bar: "from-rose-500 to-rose-400",
      label: "CRITICAL",
    };
  }
  if (score >= 40) {
    return {
      text: "text-orange-300",
      bg: "bg-orange-500/15",
      ring: "ring-orange-500/40",
      bar: "from-amber-500 to-orange-400",
      label: "ELEVATED",
    };
  }
  return {
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    ring: "ring-emerald-500/30",
    bar: "from-emerald-500 to-emerald-400",
    label: "ROUTINE",
  };
}

function RiskGauge({ value }) {
  const v = Math.max(0, Math.min(100, value));
  const tone = riskTone(v);
  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-950/40 p-4">
      <p className={`text-center text-5xl font-bold tabular-nums tracking-tight ${tone.text}`}>
        {v.toFixed(0)}
        <span className="text-xl font-semibold text-slate-500">/100</span>
      </p>
      <p className="text-center text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Clinical risk index
      </p>
      <div className="mt-4 h-4 overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/80">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone.bar} transition-[width] duration-700 ease-out`}
          style={{ width: `${v}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[9px] font-medium uppercase tracking-wider text-slate-600">
        <span className="text-emerald-500/90">Low &lt;40</span>
        <span className="text-orange-400/90">Elevated 40-74</span>
        <span className="text-rose-500/90">Critical 75+</span>
      </div>
    </div>
  );
}

const NAV = [
  { id: "triage", label: "Triage Desk", icon: Stethoscope },
  { id: "records", label: "Patient Records", icon: ClipboardList },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [selected, setSelected] = useState(null);
  const [activeNav, setActiveNav] = useState("triage");
  const [triage, setTriage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [resolved, setResolved] = useState({});
  const [health, setHealth] = useState(null);
  const [twilioLive, setTwilioLive] = useState(false);
  // Cache of triage results per patient id, for sorting + card badges.
  const [patientTriage, setPatientTriage] = useState({});
  // Per-patient loading/error so the queue can show "Connecting to AI…" on each card.
  const [patientStatus, setPatientStatus] = useState({}); // { [id]: "loading" | "error" | "ok" }
  const searchRef = useRef(null);

  const heatSeed = useMemo(
    () => Math.floor((triage?.risk_score ?? 40) * 100) % 1000,
    [triage?.risk_score]
  );

  const highRiskAlert =
    twilioLive || (triage && (triage.priority === "P1" || triage.risk_score >= 75));

  const runTriage = useCallback(async (patient, { refreshSelected = true } = {}) => {
    if (!patient) return null;
    if (refreshSelected) {
      setLoading(true);
      setErr(null);
    }
    setPatientStatus((s) => ({ ...s, [patient.id]: "loading" }));
    try {
      const { data } = await client.post("/triage", {
        voice_transcript: patient.transcript,
        patient_id: patient.id,
        patient_name: patient.name,
      });
      setPatientTriage((m) => ({ ...m, [patient.id]: data }));
      setPatientStatus((s) => ({ ...s, [patient.id]: "ok" }));
      if (refreshSelected) setTriage(data);
      return data;
    } catch (e) {
      const detail = e?.response?.data?.detail ?? e?.message ?? "Triage failed";
      setPatientStatus((s) => ({ ...s, [patient.id]: "error" }));
      if (refreshSelected) setErr(detail);
      return null;
    } finally {
      if (refreshSelected) setLoading(false);
    }
  }, []);

  // Re-run triage when user selects a patient so they always see the latest model output.
  useEffect(() => {
    if (selected) void runTriage(selected, { refreshSelected: true });
  }, [selected, runTriage]);

  // On mount: pre-triage every patient (sequentially to respect free-tier rate limits)
  // so the Status Board can display scores and sort by acuity immediately.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of MOCK_PATIENTS) {
        if (cancelled) return;
        await runTriage(p, { refreshSelected: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runTriage]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let alive = true;
    client
      .get("/health")
      .then((r) => {
        if (alive) setHealth(r.data);
      })
      .catch(() => {
        if (alive) setHealth({ status: "offline" });
      });
    return () => {
      alive = false;
    };
  }, [triage]);

  // Sort: highest risk first. Patients without a score yet go to the bottom
  // but keep their original order (stable sort). Resolved patients sink.
  const orderedPatients = useMemo(() => {
    return [...MOCK_PATIENTS]
      .map((p, idx) => ({ p, idx, t: patientTriage[p.id], r: resolved[p.id] }))
      .sort((a, b) => {
        if (!!a.r !== !!b.r) return a.r ? 1 : -1;
        const sa = a.t?.risk_score ?? -1;
        const sb = b.t?.risk_score ?? -1;
        if (sb !== sa) return sb - sa;
        return a.idx - b.idx;
      })
      .map((x) => x.p);
  }, [patientTriage, resolved]);

  const slots = useMemo(
    () => suggestedSlots(triage?.risk_score ?? 40),
    [triage?.risk_score]
  );

  const downloadFhir = async () => {
    if (!triage || !selected) return;
    try {
      const { data } = await client.post("/export", {
        patient_id: selected.id,
        patient_name: selected.name,
        risk_score: triage.risk_score,
        priority: triage.priority,
        rationale: triage.rationale,
        top_drivers: triage.top_drivers ?? [],
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/fhir+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RiskAssessment_${selected.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Export failed");
    }
  };

  const markResolved = () => {
    if (!selected) return;
    setResolved((r) => ({ ...r, [selected.id]: true }));
  };

  const nowLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Slim sidebar */}
      <aside className="flex w-[72px] shrink-0 flex-col items-center border-r border-slate-800/80 bg-slate-950 py-6">
        <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30">
          <Stethoscope className="h-5 w-5" strokeWidth={2} />
        </div>
        <nav className="flex flex-1 flex-col gap-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                onClick={() => setActiveNav(item.id)}
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all ${
                  on
                    ? "bg-sky-500 text-white shadow-lg shadow-sky-500/25"
                    : "text-slate-500 hover:bg-slate-800/80 hover:text-slate-200"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={on ? 2.25 : 2} />
              </button>
            );
          })}
        </nav>
        <div className="mt-auto rounded-lg border border-slate-800 p-1.5 text-[9px] text-slate-600">v2.0</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-800/80 bg-slate-950/90 px-6 backdrop-blur-md">
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search patients, symptoms, or records…"
              className="w-full rounded-xl border border-slate-800 bg-slate-900/80 py-2.5 pl-10 pr-24 text-sm text-slate-200 placeholder:text-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 sm:flex">
              ⌘K
            </kbd>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              type="button"
              className="relative rounded-xl p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              {highRiskAlert && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-950" />
              )}
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 py-1.5 pl-2 pr-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white">
                MD
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-xs font-semibold text-slate-200">Dr. Morgan</p>
                <p className="text-[10px] text-slate-500">Attending · ED</p>
              </div>
            </div>
          </div>
        </header>

        {err && (
          <div
            className="mx-6 mt-4 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
            role="alert"
          >
            {String(err)}
          </div>
        )}

        <LiveCallVisualizer onLiveChange={setTwilioLive} />

        <main className="grid flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-12 lg:p-6">
          {/* Status board */}
          <section className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/40 shadow-sm lg:col-span-3">
            <div className="border-b border-slate-800/80 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-slate-100">Status board</h2>
                {twilioLive && (
                  <span className="relative inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-300 ring-1 ring-sky-500/40">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
                    </span>
                    Live call
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">Sorted by Gemini risk · highest first</p>
            </div>
            <ul className="max-h-[min(70vh,640px)] flex-1 space-y-2 overflow-y-auto p-3">
              <AnimatePresence initial={false}>
                {orderedPatients.map((p) => {
                  const active = selected?.id === p.id;
                  const done = resolved[p.id];
                  const t = patientTriage[p.id];
                  const status = patientStatus[p.id];
                  const score = t?.risk_score;
                  const tone = riskTone(score);
                  return (
                    <motion.li
                      key={p.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    >
                      <motion.button
                        type="button"
                        onClick={() => setSelected(p)}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className={`relative w-full rounded-xl border px-3 py-3 text-left transition-shadow ${
                          active
                            ? "border-sky-500/60 bg-slate-800/90 shadow-lg shadow-sky-500/10"
                            : "border-slate-800/80 bg-slate-900/50 shadow-sm hover:border-slate-700 hover:shadow-md"
                        } ${done ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-100">{p.name}</span>
                              {p.live && (
                                <span className="relative flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400 ring-1 ring-emerald-500/30">
                                  <span className="relative flex h-2 w-2">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                  </span>
                                  Live
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[11px] text-slate-500">{p.id}</p>
                          </div>
                          {/* Prominent numerical risk badge */}
                          <div
                            className={`shrink-0 rounded-xl px-2.5 py-1 text-right ring-1 ${tone.bg} ${tone.ring}`}
                          >
                            {status === "loading" && score == null ? (
                              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                AI…
                              </div>
                            ) : status === "error" && score == null ? (
                              <div className="text-[10px] font-bold text-rose-300">API ERROR</div>
                            ) : (
                              <>
                                <div className={`font-mono text-lg font-extrabold leading-none tabular-nums ${tone.text}`}>
                                  {Math.round(score)}
                                  <span className="text-[10px] font-semibold text-slate-500">/100</span>
                                </div>
                                <div className={`mt-0.5 text-[9px] font-bold tracking-wider ${tone.text}`}>
                                  {t?.priority ? `${t.priority} · ${tone.label}` : tone.label}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Bottom accent bar shows risk magnitude at a glance */}
                        {score != null && (
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r ${tone.bar}`}
                              style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
                            />
                          </div>
                        )}
                        <p className="mt-2 text-[11px] text-slate-500">{formatCalled(p.minutesAgo)}</p>
                        {done && <p className="mt-1 text-[10px] font-medium text-emerald-400">Resolved</p>}
                      </motion.button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </section>

          {/* Clinical workspace */}
          <section className="relative flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-gradient-to-b from-slate-900/80 to-slate-950 shadow-sm lg:col-span-6">
            <div className="border-b border-slate-800/60 px-5 py-4 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-slate-400">
                <Sparkles className="h-4 w-4 text-sky-400" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Clinical workspace</span>
              </div>
              <h1 className="mt-1 text-lg font-semibold text-white">
                {selected ? selected.name : "No patient selected"}
              </h1>
              {selected && <p className="text-xs text-slate-500">{selected.id}</p>}
            </div>

            <AnimatePresence mode="wait">
              {!selected && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-20 text-center"
                >
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 shadow-sm">
                    <Mic className="mx-auto h-12 w-12 text-slate-600" strokeWidth={1.25} />
                    <p className="mt-4 text-sm font-medium text-slate-300">No patient selected</p>
                    <p className="mt-1 max-w-xs text-xs text-slate-500">
                      Choose a case from the status board to run Gemini triage and view the clinical record.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {selected && (
              <div className="relative flex-1 overflow-y-auto p-5">
                <AnimatePresence>
                  {loading && (
                    <motion.div
                      key="load"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-md"
                    >
                      <Loader2 className="h-10 w-10 animate-spin text-sky-400" />
                      <p className="mt-3 text-sm font-medium text-slate-200">Connecting to AI…</p>
                      <p className="mt-1 text-xs text-slate-500">Gemini clinical orchestrator</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Dictation + transcript bubble */}
                <div className="mb-6 rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 shadow-sm backdrop-blur-md">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Dictation · voice transcript
                    </span>
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-400">
                      {nowLabel}
                    </span>
                  </div>
                  <div className="rounded-2xl rounded-tl-sm border border-slate-700/60 bg-slate-900/60 px-4 py-3 text-sm leading-relaxed text-slate-200 shadow-inner">
                    {selected.transcript}
                  </div>
                </div>

                {/* Reasoning + gauge */}
                <div className="mb-6 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 shadow-sm backdrop-blur-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">AI reasoning flow</p>
                  <div className="mt-4 grid gap-6 md:grid-cols-2">
                    <div>
                      <RiskGauge value={triage?.risk_score ?? 0} />
                      {triage?.top_drivers?.length ? (
                        <div className="mt-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                            Top clinical drivers
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {triage.top_drivers.map((d, i) => (
                              <span
                                key={`${d}-${i}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-900/60 px-2 py-1 text-[11px] font-medium text-slate-200"
                              >
                                <span className="text-[9px] font-bold text-sky-400">{i + 1}</span>
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col justify-center space-y-3">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="h-px flex-1 bg-gradient-to-r from-sky-500/50 to-transparent" />
                        <span>Rationale</span>
                      </div>
                      <p className="text-sm leading-relaxed text-slate-300">
                        {triage?.rationale ?? (loading ? "Connecting to AI…" : "—")}
                      </p>
                      {triage?.priority && (
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                              triage.priority === "P1"
                                ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40"
                                : triage.priority === "P2"
                                  ? "bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/30"
                                  : "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            }`}
                          >
                            Priority {triage.priority}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-slate-600">
                            Source: {triage.source}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void downloadFhir()}
                    disabled={!triage || loading}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 min-[420px]:flex-initial"
                  >
                    <Download className="h-4 w-4" />
                    Download FHIR
                  </button>
                  <button
                    type="button"
                    onClick={markResolved}
                    disabled={!triage}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800/80 px-5 py-3 text-sm font-semibold text-slate-100 shadow-sm transition hover:bg-slate-800 disabled:opacity-40 min-[420px]:flex-initial"
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Mark resolved
                  </button>
                  <button
                    type="button"
                    onClick={() => client.get("/health").then((r) => setHealth(r.data)).catch(() => setHealth({ status: "offline" }))}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
                  >
                    <Wifi className="h-4 w-4" />
                    System status
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Load intelligence */}
          <section className="flex flex-col rounded-2xl border border-slate-800/80 bg-slate-900/40 shadow-sm lg:col-span-3">
            <div className="border-b border-slate-800/80 px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Flame className="h-4 w-4 text-orange-400" />
                Load intelligence
              </h2>
              <p className="text-[11px] text-slate-500">Synthetic occupancy · demo</p>
            </div>
            <div className="overflow-x-auto p-3">
              <div
                className="grid gap-1.5"
                style={{ gridTemplateColumns: `44px repeat(${HEAT_COLS.length}, minmax(0,1fr))` }}
              >
                <div />
                {HEAT_COLS.map((d) => (
                  <div key={d} className="text-center text-[10px] font-bold uppercase text-slate-500">
                    {d}
                  </div>
                ))}
                {HEAT_ROWS.map((t, ri) => (
                  <div key={t} style={{ display: "contents" }}>
                    <div className="flex items-center text-[10px] font-mono text-slate-500">{t}</div>
                    {HEAT_COLS.map((_, ci) => {
                      const v = hashLoad(heatSeed, ri, ci);
                      return (
                        <div
                          key={`${t}-${ci}`}
                          title={`Load ${v}`}
                          style={heatCellStyle(v)}
                          className="flex aspect-square min-h-[32px] items-center justify-center rounded-lg text-[10px] font-bold text-white/90 shadow-sm ring-1 ring-black/10"
                        >
                          {v}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-800/80 px-4 py-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Calendar className="h-3.5 w-3.5 text-sky-400" />
                Suggested slots
              </h3>
              <p className="mt-0.5 text-[10px] text-slate-500">OR-Tools CP-SAT · calendar-style</p>
            </div>
            <ul className="space-y-3 p-3 pt-0">
              {slots.map((s) => (
                <li
                  key={`${s.day}-${s.time}`}
                  className="overflow-hidden rounded-xl border border-slate-700/80 bg-slate-900/60 shadow-sm"
                >
                  <div className="border-l-4 border-sky-500 px-3 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-sky-400/90">{s.day}</p>
                        <p className="text-sm font-semibold text-white">{s.time}</p>
                        <p className="text-xs text-slate-400">{s.doctor}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{s.room} · {s.subtitle}</p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-lg bg-sky-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-md shadow-sky-500/20 transition hover:bg-sky-400"
                      >
                        Quick book
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-auto border-t border-slate-800/80 p-3">
              <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <Activity className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-slate-500">API</p>
                  <pre className="mt-1 max-h-24 overflow-auto text-[10px] leading-snug text-slate-500">
                    {JSON.stringify(health ?? {}, null, 0)}
                  </pre>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
