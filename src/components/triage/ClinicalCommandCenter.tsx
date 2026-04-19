import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Activity,
  CheckCircle2,
  ClipboardList,
  Download,
  Filter,
  Mic,
  Stethoscope,
  Terminal,
} from "lucide-react";
import type { PatientRecord } from "../../App";
import type { RiskWithShap } from "../../lib/mlApi";
import { fetchModelDiagnostics } from "../../lib/mlApi";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const TIME_LABELS = ["9a", "10a", "11a", "1p", "2p", "3p"] as const;

function riskBadgeClasses(band: string): string {
  if (band === "Critical" || band === "High") return "bg-rose-50 text-rose-800 border-rose-200";
  if (band === "Moderate") return "bg-amber-50 text-amber-900 border-amber-200";
  return "bg-emerald-50 text-emerald-900 border-emerald-200";
}

function ClinicalLoadHeatmap({
  heat,
  pulseKeys,
}: {
  heat: number[][];
  pulseKeys: Set<string>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-slate-600" />
        <h4 className="text-sm font-semibold text-slate-800">Clinic load (5×6)</h4>
      </div>
      <p className="text-[11px] text-slate-500 mb-3 leading-snug">
        Values reflect scheduled acuity. OR-Tools suggested windows pulse softly in blue.
      </p>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-1 min-w-[280px]"
          style={{ gridTemplateColumns: `52px repeat(${DAYS.length}, minmax(0, 1fr))` }}
        >
          <div />
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-slate-500 uppercase py-1">
              {d}
            </div>
          ))}
          {TIME_LABELS.map((t, ti) => (
            <div key={t} className="contents">
              <div className="text-[10px] font-mono text-slate-500 flex items-center">{t}</div>
              {DAYS.map((_, di) => {
                const v = heat[ti]?.[di] ?? 0;
                const pulse = pulseKeys.has(`${ti}-${di}`);
                const bg =
                  v < 25
                    ? "bg-slate-100 border-slate-200"
                    : v < 50
                      ? "bg-teal-50 border-teal-100"
                      : v < 75
                        ? "bg-amber-50 border-amber-100"
                        : "bg-rose-50 border-rose-100";
                return (
                  <motion.div
                    key={`${t}-${di}`}
                    animate={pulse ? { boxShadow: ["0 0 0 0 rgba(59,130,246,0)", "0 0 0 4px rgba(59,130,246,0.25)", "0 0 0 0 rgba(59,130,246,0)"] } : {}}
                    transition={{ duration: 2.2, repeat: pulse ? Infinity : 0, ease: "easeInOut" }}
                    className={`aspect-square rounded-md border flex items-center justify-center text-[10px] font-medium min-h-[32px] ${bg} ${pulse ? "ring-1 ring-blue-300/60" : ""}`}
                    title={`Load ${Math.round(v)}`}
                  >
                    <span className="text-slate-700">{Math.round(v)}</span>
                  </motion.div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type Props = {
  patients: PatientRecord[];
  selectedId: string;
  onSelectId: (id: string) => void;
  selected: PatientRecord;
  risk: RiskWithShap | null;
  loading: boolean;
  retraining: boolean;
  exporting: boolean;
  slotPayload: {
    top_slots: Array<Record<string, unknown>>;
    patient_summary?: Record<string, unknown>;
  } | null;
  heat: number[][];
  onRefresh: () => Promise<void>;
  onRetrain: () => Promise<void>;
  onDownloadBundle: () => Promise<void>;
  onResolve: () => void;
  onAudit: (action: string, detail?: string) => void;
};

export function ClinicalCommandCenter({
  patients,
  selectedId,
  onSelectId,
  selected,
  risk,
  loading,
  retraining,
  exporting,
  slotPayload,
  heat,
  onRefresh,
  onRetrain,
  onDownloadBundle,
  onResolve,
  onAudit,
}: Props) {
  const [entryFilter, setEntryFilter] = useState<"all" | "voice" | "manual">("all");

  const filtered = useMemo(() => {
    return patients.filter((p) => {
      const src = p.entrySource ?? "voice";
      if (entryFilter === "all") return true;
      return src === entryFilter;
    });
  }, [patients, entryFilter]);

  const score = risk?.risk_score ?? selected.riskScore;
  const band = risk?.risk_band ?? (score >= 80 ? "Critical" : score >= 60 ? "High" : score >= 35 ? "Moderate" : "Low");

  const pulseKeys = useMemo(() => {
    const s = new Set<string>();
    const slots = (slotPayload?.top_slots ?? []) as Array<{ day?: string; time?: string }>;
    const dayIdx: Record<string, number> = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4 };
    const timeIdx: Record<string, number> = {
      "9:00 AM": 0,
      "10:00 AM": 1,
      "11:00 AM": 2,
      "1:00 PM": 3,
      "2:00 PM": 4,
      "3:00 PM": 5,
    };
    for (const sl of slots) {
      const di = dayIdx[sl.day ?? ""];
      const ti = timeIdx[sl.time ?? ""];
      if (di !== undefined && ti !== undefined) s.add(`${ti}-${di}`);
    }
    return s;
  }, [slotPayload]);

  const shapMax = useMemo(() => {
    const xs = risk?.top_shap_contributions?.map((x) => Math.abs(x.shap_value)) ?? [1];
    return Math.max(...xs, 0.001);
  }, [risk]);

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-slate-50 text-slate-900 shadow-sm overflow-hidden font-[Inter,system-ui,sans-serif]">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-0 xl:divide-x divide-slate-200/80">
        {/* Column 1 — Queue */}
        <div className="xl:col-span-3 p-5 bg-white xl:min-h-[640px] flex flex-col border-b xl:border-b-0 border-slate-200">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-semibold text-slate-900">Patient queue</h3>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-4 text-[11px]">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500">Entry</span>
            {(["all", "voice", "manual"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setEntryFilter(f)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                  entryFilter === f
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                }`}
              >
                {f === "all" ? "All" : f === "voice" ? "Voice" : "Manual"}
              </button>
            ))}
          </div>
          <ul className="space-y-2 flex-1 overflow-y-auto max-h-[520px] pr-1 custom-scrollbar">
            {filtered.map((p) => {
              const active = p.id === selectedId;
              const pb = p.riskScore >= 70 ? "High" : p.riskScore >= 40 ? "Moderate" : "Low";
              const badge = riskBadgeClasses(pb === "High" ? "High" : pb);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectId(p.id);
                      onAudit("queue_select_patient", p.id);
                    }}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      active ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900/10" : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 leading-tight">{p.name}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {p.condition} · {p.id}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${badge}`}>
                        {pb === "High" ? "Elevated" : pb === "Moderate" ? "Watch" : "Stable"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-400">
                      {p.entrySource === "manual" ? (
                        <span className="inline-flex items-center gap-0.5 text-slate-600">
                          <Stethoscope className="w-3 h-3" /> Manual
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-slate-600">
                          <Mic className="w-3 h-3" /> Voice
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Column 2 — Context */}
        <div className="xl:col-span-6 p-5 bg-slate-50/80 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">MedASR transcript</p>
            <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap min-h-[72px]">
              {selected.callNotes || "No transcript attached — link voice encounter or enter chart notes."}
            </p>
            {risk?.medasr_entity_hits && risk.medasr_entity_hits.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {risk.medasr_entity_hits.slice(0, 8).map((h) => (
                  <span
                    key={h}
                    className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-teal-50 text-teal-900 border border-teal-100"
                  >
                    {h}
                  </span>
                ))}
                {risk.medasr_high_priority && (
                  <span className="text-[10px] font-semibold text-rose-700">High-priority clinical entity match</span>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Explainable AI (SHAP)</p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${riskBadgeClasses(band)}`}>
                {band} · {score.toFixed(1)}
              </span>
            </div>
            {!risk?.top_shap_contributions?.length ? (
              <p className="text-xs text-slate-500">Run refresh to load model attributions.</p>
            ) : (
              <ul className="space-y-3">
                {risk.top_shap_contributions.map((t) => {
                  const pct = (Math.abs(t.shap_value) / shapMax) * 100;
                  return (
                    <li key={t.feature}>
                      <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                        <span className="font-medium text-slate-800">{t.feature}</span>
                        <span className="tabular-nums text-slate-500">{t.shap_value.toFixed(3)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200/80">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-slate-400 via-teal-600/70 to-slate-500"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Clinical co-pilot (CDS)</p>
            <ul className="space-y-2">
              {(risk?.clinical_recommendations?.length ? risk.clinical_recommendations : ["Refresh scores to load CDS rules."]).map(
                (line, i) => (
                  <li key={i} className="text-xs text-slate-700 leading-snug flex gap-2">
                    <span className="text-teal-600 font-bold">•</span>
                    <span>{line}</span>
                  </li>
                )
              )}
            </ul>
          </div>
        </div>

        {/* Column 3 — Schedule & actions */}
        <div className="xl:col-span-3 p-5 bg-white space-y-4 xl:min-h-[640px]">
          <ClinicalLoadHeatmap heat={heat} pulseKeys={pulseKeys} />

          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Suggested slots (OR-Tools)</p>
            <ul className="space-y-2">
              {((slotPayload?.top_slots ?? []) as Array<Record<string, unknown>>).slice(0, 3).map((s, i) => (
                <li
                  key={String(s.slot_id ?? i)}
                  className="text-xs text-slate-800 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2"
                >
                  <span className="font-semibold text-slate-900">{String(s.day)}</span>{" "}
                  <span className="text-slate-600">{String(s.time)}</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">{String(s.doctor)}</span>
                </li>
              ))}
              {!slotPayload?.top_slots?.length && <li className="text-xs text-slate-500">No slots yet — refresh.</li>}
            </ul>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  onAudit("action_download_fhir_export");
                  void onDownloadBundle();
                }}
                disabled={exporting}
                title={
                  loading
                    ? "Scores still loading — you can click after refresh finishes, or use Refresh scores"
                    : "Download FHIR export (needs risk + priority from Refresh scores)"
                }
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 shadow-sm"
              >
                <Download className="w-4 h-4" />
                {exporting ? "…" : "FHIR bundle"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onAudit("action_resolve");
                  onResolve();
                }}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
              >
                <CheckCircle2 className="w-4 h-4" />
                Resolved
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  onAudit("action_refresh");
                  void onRefresh();
                }}
                disabled={retraining}
                title={loading ? "Refresh in progress…" : "Reload risk, priority, and slots from ML"}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {loading ? "Refreshing…" : "Refresh scores"}
              </button>
              <button
                type="button"
                onClick={() => {
                  onAudit("action_retrain");
                  void onRetrain();
                }}
                disabled={retraining}
                title="API triage: server returns a no-op message (no local retrain)"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Retrain ML
              </button>
              <button
                type="button"
                onClick={async () => {
                  onAudit("system_diagnostics");
                  try {
                    const d = await fetchModelDiagnostics();
                    window.alert(JSON.stringify(d, null, 2));
                  } catch {
                    window.alert("Diagnostics unavailable — is the ML backend running?");
                  }
                }}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Terminal className="w-3.5 h-3.5" />
                Diagnostics
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
