import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Stethoscope } from "lucide-react";
import type { PatientRecord } from "../../App";
import { fetchRetrainModels, fetchRiskWithShap, fetchSlotRecommend, type RiskWithShap } from "../../lib/mlApi";
import { PatientTriageCard } from "./PatientTriageCard";
import { TriageSidebar } from "./TriageSidebar";
import { SuggestedSlotsPanel } from "./SuggestedSlotsPanel";
import { UrgencyHeatmap, buildHeatFromSchedule } from "./UrgencyHeatmap";

const scheduleSlots = [
  { time: "9:00 AM", mon: "P001", tue: "P006", wed: null, thu: "P012", fri: "P015" },
  { time: "10:00 AM", mon: "P004", tue: null, wed: "P009", thu: "P005", fri: null },
  { time: "11:00 AM", mon: null, tue: "P011", wed: "P002", thu: null, fri: "P007" },
  { time: "1:00 PM", mon: "P003", tue: "P008", wed: null, thu: "P013", fri: "P010" },
  { time: "2:00 PM", mon: null, tue: "P014", wed: "P015", thu: null, fri: "P001" },
  { time: "3:00 PM", mon: "P007", tue: null, wed: "P006", thu: "P009", fri: null },
];

type Toast = { type: "success" | "error"; message: string };

export function TriageDesk({
  patients,
  getPatientById,
}: {
  patients: PatientRecord[];
  getPatientById: (id: string | null) => PatientRecord | undefined;
}) {
  const incoming = useMemo(() => patients.filter((p) => p.status === "In Call Queue"), [patients]);
  const [selectedId, setSelectedId] = useState(patients[0]?.id ?? "");
  const selected = patients.find((p) => p.id === selectedId) ?? patients[0];

  const [risk, setRisk] = useState<RiskWithShap | null>(null);
  const [slotPayload, setSlotPayload] = useState<{
    top_slots: Array<Record<string, unknown>>;
    patient_summary: Record<string, unknown>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [retraining, setRetraining] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const daysSince = selected
    ? Math.max(0, Math.floor((Date.now() - new Date(selected.lastVisit).getTime()) / 86400000))
    : 0;

  const refresh = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setErr(null);
    try {
      const [r, s] = await Promise.all([
        fetchRiskWithShap(selected, daysSince),
        fetchSlotRecommend(selected, daysSince),
      ]);
      setRisk(r);
      setSlotPayload(s);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "ML unreachable");
      setRisk(null);
      setSlotPayload(null);
    } finally {
      setLoading(false);
    }
  }, [selected, daysSince]);

  useEffect(() => {
    void refresh();
  }, [selectedId, refresh]);

  const retrainAndRefresh = useCallback(async () => {
    setRetraining(true);
    setToast(null);
    setErr(null);
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 180000);
    try {
      await fetchRetrainModels(ac.signal);
      await refresh();
      setToast({ type: "success", message: "Models retrained. Risk gauge and slots updated." });
      window.setTimeout(() => setToast(null), 5000);
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.name === "AbortError"
          ? "Retrain timed out — Render free tier may be waking (~30s). Retry."
          : e instanceof Error
            ? e.message
            : "Retrain failed";
      setToast({ type: "error", message: msg });
      setErr(msg);
      window.setTimeout(() => setToast(null), 8000);
    } finally {
      clearTimeout(timer);
      setRetraining(false);
    }
  }, [refresh]);

  const heat = useMemo(
    () => buildHeatFromSchedule(scheduleSlots as Array<Record<string, string | null>>, getPatientById),
    [getPatientById]
  );

  if (!selected) {
    return <p className="text-slate-500 p-8">No patients loaded.</p>;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col xl:flex-row gap-8 max-w-[1400px] mx-auto"
    >
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className={`fixed bottom-6 right-6 z-[90] max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
              toast.type === "success"
                ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
                : "border-rose-500/40 bg-rose-950/90 text-rose-100"
            }`}
            role="status"
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>

      <TriageSidebar queue={incoming} />

      <div className="flex-1 min-w-0 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-500/90 mb-2">
              <Stethoscope className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-widest">MediVoice · Triage Desk</span>
            </div>
            <h2 className="text-3xl font-black text-white tracking-tight">Patient-centered triage</h2>
            <p className="text-slate-400 mt-1 text-sm">
              Set <code className="text-slate-500">VITE_ML_BACKEND_URL</code> on Render for the ML service.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <span className="font-bold text-slate-500">Active chart</span>
            <div className="relative">
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="appearance-none pl-4 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-bold focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/40"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </label>
        </div>

        {err && !retraining && (
          <div className="rounded-xl border border-rose-600/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-300">
            {err}
          </div>
        )}

        <PatientTriageCard
          patient={selected}
          risk={risk}
          loading={loading}
          onRefreshRisk={refresh}
          onRetrain={retrainAndRefresh}
          retraining={retraining}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <SuggestedSlotsPanel
            slots={(slotPayload?.top_slots as Array<Record<string, unknown>>) ?? []}
            patientSummary={slotPayload?.patient_summary}
          />
          <UrgencyHeatmap heat={heat} />
        </div>
      </div>
    </motion.div>
  );
}
