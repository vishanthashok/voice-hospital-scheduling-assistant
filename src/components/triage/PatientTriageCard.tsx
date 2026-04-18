import { useState } from "react";
import { motion } from "motion/react";
import { Brain, Download, FileJson, RefreshCw } from "lucide-react";
import type { PatientRecord } from "../../App";
import { RiskGauge } from "./RiskGauge";
import type { RiskWithShap } from "../../lib/mlApi";
import { handleDownloadFHIR } from "../../lib/mlApi";
import { AiLogicModal } from "./AiLogicModal";

function pLevel(band: string, mlPriority: string): { tag: string; sub: string; ring: string } {
  if (band === "Critical")
    return { tag: "P1", sub: "Immediate attention", ring: "ring-2 ring-orange-700 ring-offset-2 ring-offset-slate-900" };
  if (band === "High" || mlPriority === "High")
    return { tag: "P1", sub: "High acuity", ring: "ring-2 ring-rose-600/80 ring-offset-2 ring-offset-slate-900" };
  if (band === "Moderate" || mlPriority === "Medium")
    return { tag: "P2", sub: "Standard triage", ring: "ring-1 ring-amber-500/40" };
  return { tag: "P3", sub: "Routine", ring: "ring-1 ring-emerald-500/30" };
}

export function PatientTriageCard({
  patient,
  risk,
  loading,
  onRefreshRisk,
  onRetrain,
  retraining,
}: {
  patient: PatientRecord;
  risk: RiskWithShap | null;
  loading: boolean;
  /** Re-fetch risk + slots after models or data change */
  onRefreshRisk: () => Promise<void>;
  /** Retrain RF + GB models (GET /model/retrain), then caller refreshes risk */
  onRetrain: () => Promise<void>;
  retraining: boolean;
}) {
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const score = risk?.risk_score ?? patient.riskScore;
  const band =
    risk?.risk_band ??
    (score >= 80 ? "Critical" : score >= 60 ? "High" : score >= 35 ? "Moderate" : "Low");
  const mlPri = risk ? (score >= 60 ? "High" : score >= 35 ? "Medium" : "Low") : patient.priority;
  const pl = pLevel(band, mlPri);

  const daysSince = Math.max(
    0,
    Math.floor((Date.now() - new Date(patient.lastVisit).getTime()) / 86400000)
  );

  const onDownloadFhir = async () => {
    setExporting(true);
    try {
      await handleDownloadFHIR(patient, daysSince);
    } catch (e) {
      console.error(e);
      alert(
        e instanceof Error
          ? e.message
          : "FHIR export failed. If the backend was asleep (Render free tier), wait ~30s and retry."
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <motion.div layout className="w-full max-w-xl mx-auto">
        <div className="p-8 rounded-3xl border border-slate-800 bg-slate-900/80 backdrop-blur-sm flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Patient · FHIR</p>
              <h3 className="text-2xl font-bold text-white tracking-tight">{patient.name}</h3>
              <p className="text-sm text-slate-400 mt-1">
                <span className="text-emerald-500/90">Coverage</span> {patient.insurance} ·{" "}
                <span className="text-slate-500">Patient/{patient.id}</span>
              </p>
            </div>
            <div
              className={`rounded-2xl px-4 py-2 bg-slate-950 border border-slate-800 text-center ${pl.ring}`}
            >
              <span className="text-2xl font-black text-white">{pl.tag}</span>
              <p className="text-[10px] text-slate-500 uppercase font-bold">{pl.sub}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-8 items-center">
            <RiskGauge value={score} band={band} />
            <div className="flex-1 space-y-2 text-sm">
              <Row label="Condition" value={patient.condition} />
              <Row label="Last visit" value={patient.lastVisit} />
              <Row label="Language" value={patient.language} />
              <Row label="Assigned MD" value={patient.doctor} />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              onClick={() => setAiModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-sm font-bold hover:bg-slate-700 transition-colors"
            >
              <Brain className="w-4 h-4 text-violet-400" />
              View AI Logic
            </button>
            <button
              type="button"
              onClick={() => void onRetrain()}
              disabled={retraining || loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${retraining ? "animate-spin" : ""}`} />
              {retraining ? "Retraining…" : "Refresh ML"}
            </button>
            <button
              type="button"
              onClick={() => void onRefreshRisk()}
              disabled={loading || retraining}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600 text-slate-400 text-sm font-bold hover:bg-slate-800 disabled:opacity-50 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh scores
            </button>
            <button
              type="button"
              onClick={() => void onDownloadFhir()}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 text-sm font-bold hover:bg-emerald-600/30"
            >
              <Download className="w-4 h-4" />
              {exporting ? "…" : "Download Medical Record"}
            </button>
          </div>
          <p className="text-[10px] text-slate-600 flex items-center gap-1">
            <FileJson className="w-3 h-3" />
            HL7 FHIR R4 <code className="text-slate-500">RiskAssessment</code> JSON ·{" "}
            <code className="text-slate-600">VITE_ML_BACKEND_URL</code> for Render
          </p>
        </div>
      </motion.div>

      <AiLogicModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        patient={patient}
        daysSince={daysSince}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-800/60 pb-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 font-medium text-right">{value}</span>
    </div>
  );
}
