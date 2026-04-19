import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Activity, Download, Loader2, Stethoscope } from "lucide-react";
import type { PatientRecord } from "../../App";
import {
  analyzeClinicalTriage,
  fetchMlHealth,
  fetchSlotRecommend,
  getMlBackendOrigin,
  getSessionId,
  mlUrl,
  type ClinicalTriageResponse,
} from "../../lib/mlApi";
import { buildHeatFromSchedule, UrgencyHeatmap } from "./UrgencyHeatmap";

const scheduleSlots = [
  { time: "9:00 AM", mon: "P001", tue: "P006", wed: null, thu: "P012", fri: "P015" },
  { time: "10:00 AM", mon: "P004", tue: null, wed: "P009", thu: "P005", fri: null },
  { time: "11:00 AM", mon: null, tue: "P011", wed: "P002", thu: null, fri: "P007" },
  { time: "1:00 PM", mon: "P003", tue: "P008", wed: null, thu: "P013", fri: "P010" },
  { time: "2:00 PM", mon: null, tue: "P014", wed: "P015", thu: null, fri: "P001" },
  { time: "3:00 PM", mon: "P007", tue: null, wed: "P006", thu: "P009", fri: null },
];

function priorityBadgeClasses(pl: string): string {
  if (pl === "P1") return "bg-rose-100 text-rose-900 border-rose-200";
  if (pl === "P2") return "bg-amber-100 text-amber-950 border-amber-200";
  return "bg-emerald-100 text-emerald-900 border-emerald-200";
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (typeof e === "object" && e !== null && "name" in e && (e as { name: string }).name === "AbortError")
    return true;
  return false;
}

export function GeminiClinicalDashboard({
  patients: initialPatients,
  getPatientById,
}: {
  patients: PatientRecord[];
  getPatientById: (id: string | null) => PatientRecord | undefined;
}) {
  const [queuePatients, setQueuePatients] = useState<PatientRecord[]>(initialPatients);
  const [selectedId, setSelectedId] = useState(initialPatients[0]?.id ?? "");
  const selected = useMemo(
    () => queuePatients.find((p) => p.id === selectedId) ?? queuePatients[0],
    [queuePatients, selectedId]
  );

  const [analysis, setAnalysis] = useState<ClinicalTriageResponse | null>(null);
  const [slots, setSlots] = useState<{ top_slots: Array<Record<string, unknown>> } | null>(null);
  /** Only Gemini/triage — do not block on `/recommend/slot` or the UI looks stuck forever. */
  const [triageLoading, setTriageLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mlOnline, setMlOnline] = useState<boolean | null>(null);
  const runAbortRef = useRef<AbortController | null>(null);
  const runGenRef = useRef(0);
  /** Avoid re-running triage when only the patient list reference changes (synthetic load) — that was aborting the first Gemini call and could leave the UI stuck on “analyzing”. */
  const queuePatientsRef = useRef(queuePatients);
  queuePatientsRef.current = queuePatients;

  useEffect(() => {
    let alive = true;
    fetch(mlUrl("/scheduler/synthetic-patients?limit=120"))
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { patients?: PatientRecord[] }) => {
        if (!alive || !d.patients?.length) return;
        setQueuePatients(d.patients as PatientRecord[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!queuePatients.length) return;
    if (!queuePatients.some((p) => p.id === selectedId)) {
      setSelectedId(queuePatients[0].id);
    }
  }, [queuePatients, selectedId]);

  const heat = useMemo(
    () => buildHeatFromSchedule(scheduleSlots as Array<Record<string, string | null>>, getPatientById),
    [getPatientById]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ok } = await fetchMlHealth();
        if (!cancelled) setMlOnline(ok);
      } catch {
        if (!cancelled) setMlOnline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runAnalyze = useCallback(async () => {
    runAbortRef.current?.abort();
    const ac = new AbortController();
    runAbortRef.current = ac;
    const gen = ++runGenRef.current;

    const sel = queuePatientsRef.current.find((p) => p.id === selectedId);
    if (!sel) {
      if (runGenRef.current === gen) {
        setTriageLoading(false);
        setSlotsLoading(false);
      }
      return;
    }
    const daysSince = Math.max(
      0,
      Math.floor((Date.now() - new Date(sel.lastVisit).getTime()) / 86400000)
    );
    setTriageLoading(true);
    setSlotsLoading(false);
    setErr(null);
    setAnalysis(null);
    setSlots(null);
    let out: ClinicalTriageResponse | null = null;
    try {
      out = await analyzeClinicalTriage(
        {
          patient_id: sel.id,
          patient_name: sel.name,
          age: sel.age,
          gender: sel.gender,
          condition: sel.condition,
          voice_transcript: sel.callNotes ?? "",
          session_id: getSessionId(),
        },
        { signal: ac.signal }
      );
      if (runGenRef.current !== gen) return;
      setAnalysis(out);
    } catch (e: unknown) {
      if (isAbortError(e) || runGenRef.current !== gen) return;
      setErr(e instanceof Error ? e.message : "Triage failed");
      setAnalysis(null);
      setSlots(null);
    } finally {
      if (runGenRef.current === gen) {
        setTriageLoading(false);
        try {
          const { ok } = await fetchMlHealth();
          setMlOnline(ok);
        } catch {
          setMlOnline(false);
        }
      }
    }
    if (!out || runGenRef.current !== gen) return;
    setSlotsLoading(true);
    try {
      const slotData = await fetchSlotRecommend(sel, daysSince, { signal: ac.signal });
      if (runGenRef.current !== gen) return;
      setSlots(slotData);
    } catch (e: unknown) {
      if (isAbortError(e) || runGenRef.current !== gen) return;
      setSlots(null);
    } finally {
      if (runGenRef.current === gen) setSlotsLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void runAnalyze();
  }, [runAnalyze]);

  useEffect(
    () => () => {
      runAbortRef.current?.abort();
    },
    []
  );

  const downloadFhir = () => {
    if (!analysis?.fhir_risk_assessment) return;
    const blob = new Blob([JSON.stringify(analysis.fhir_risk_assessment, null, 2)], {
      type: "application/fhir+json",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `FHIR_RiskAssessment_${selected?.id ?? "patient"}.json`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const directOrigin = getMlBackendOrigin();
  const routingHint = directOrigin
    ? `API → ${directOrigin}`
    : "API → /api/ml → Express proxy.";
  const queueLocked = triageLoading || slotsLoading;

  if (!selected) {
    return <p className="text-slate-500 p-8">No patients loaded.</p>;
  }

  const maxW = Math.max(...(analysis?.top_drivers ?? []).map((d) => d.weight), 0.01);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-slate-600 mb-1">
            <Stethoscope className="w-5 h-5" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">MediVoice 2.0</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Clinical command center</h2>
          <p className="text-xs text-slate-500 mt-1">{routingHint}</p>
          <p className="text-xs text-slate-600 mt-2 max-w-xl leading-relaxed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-semibold text-slate-700">Demo mode:</span> one triage score at a time — finish the
            current Gemini run before switching patients (server also queues concurrent requests).
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {mlOnline === null && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-600">
                <Activity className="h-3.5 w-3.5 animate-pulse" />
                Checking ML…
              </span>
            )}
            {mlOnline === true && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-800">
                ML online
              </span>
            )}
            {mlOnline === false && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-rose-800">
                ML offline
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void runAnalyze()}
          disabled={triageLoading || slotsLoading}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          {triageLoading ? "Gemini…" : slotsLoading ? "Scheduling…" : "Refresh triage"}
        </button>
      </div>

      {err && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{err}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Queue */}
        <div className="xl:col-span-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Triage queue</h3>
          {queueLocked && (
            <p className="text-[11px] text-slate-500 mb-2">Scoring in progress — queue locked.</p>
          )}
          <ul className="space-y-2 max-h-[560px] overflow-y-auto">
            {queuePatients.map((p) => {
              const active = p.id === selectedId;
              const switchBlocked = queueLocked && !active;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!switchBlocked) setSelectedId(p.id);
                    }}
                    disabled={switchBlocked}
                    className={`w-full text-left rounded-xl border px-3 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      active ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900/10" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${priorityBadgeClasses(
                          analysis && p.id === selected?.id ? analysis.priority_level : "P3"
                        )}`}
                      >
                        {analysis && p.id === selected?.id ? analysis.priority_level : "—"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {p.condition} · {p.id}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Deep dive */}
        <div className="xl:col-span-6 space-y-4 relative">
          <AnimatePresence>
            {triageLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-white/80 backdrop-blur-sm border border-slate-200"
              >
                <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-2" />
                <p className="text-sm font-medium text-slate-700">Gemini is analyzing…</p>
                <p className="text-xs text-slate-500 mt-1">Building risk, priority, and FHIR RiskAssessment</p>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Voice transcript</p>
            <p className="text-sm text-slate-800 whitespace-pre-wrap min-h-[100px] leading-relaxed">
              {selected.callNotes || "No transcript — select a patient with chart notes."}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Gemini rationale</p>
              {analysis && (
                <span className="text-xs font-semibold text-slate-700">
                  Risk {analysis.risk_score.toFixed(1)} · {analysis.risk_band} · {analysis.priority_level}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-800 leading-relaxed">
              {analysis?.clinical_rationale ?? "Run refresh or select a patient to analyze."}
            </p>
            {analysis && (
              <p className="text-[10px] text-slate-400 mt-2">Source: {analysis.source}</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-3">Top clinical drivers</p>
            <ul className="space-y-3">
              {(analysis?.top_drivers ?? []).map((d) => (
                <li key={d.factor}>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span className="font-medium text-slate-900">{d.factor}</span>
                    <span className="tabular-nums text-slate-500">{d.weight.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-slate-600"
                      style={{ width: `${Math.min(100, (d.weight / maxW) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">{d.note}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Schedule + heatmap */}
        <div className="xl:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 overflow-hidden">
            <UrgencyHeatmap heat={heat} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Suggested windows</p>
            <ul className="space-y-2">
              {slotsLoading && (
                <li className="text-xs text-slate-600 flex items-center gap-2 py-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  Finding slots…
                </li>
              )}
              {!slotsLoading &&
                (slots?.top_slots ?? []).slice(0, 3).map((s, i) => (
                  <li key={String(s.slot_id ?? i)} className="text-xs rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2 text-slate-800">
                    <span className="font-semibold">{String(s.day)}</span> {String(s.time)} · {String(s.doctor ?? "")}
                  </li>
                ))}
              {!slotsLoading && !slots?.top_slots?.length && (
                <li className="text-xs text-slate-500">No slots yet</li>
              )}
            </ul>
          </div>
          <button
            type="button"
            onClick={downloadFhir}
            disabled={!analysis?.fhir_risk_assessment || triageLoading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Download medical record (FHIR)
          </button>
        </div>
      </div>
    </motion.div>
  );
}
