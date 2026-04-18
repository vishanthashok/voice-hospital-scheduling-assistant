import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X, Loader2, Brain } from "lucide-react";
import type { PatientRecord } from "../../App";
import { fetchRiskWithShap, type RiskWithShap } from "../../lib/mlApi";

export function AiLogicModal({
  open,
  onClose,
  patient,
  daysSince,
}: {
  open: boolean;
  onClose: () => void;
  patient: PatientRecord;
  daysSince: number;
}) {
  const [data, setData] = useState<RiskWithShap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetchRiskWithShap(patient, daysSince);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patient, daysSince]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const contributions = data?.top_shap_contributions ?? [];
  const rationale = data?.clinical_rationale ?? {};
  const maxAbs = Math.max(...contributions.map((c) => Math.abs(c.shap_value)), 1e-6);

  const node = (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-logic-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm"
            aria-label="Close dialog"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/50 max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-800 bg-slate-950/80">
              <div className="flex items-center gap-2 min-w-0">
                <Brain className="w-5 h-5 text-violet-400 shrink-0" />
                <h2 id="ai-logic-title" className="text-lg font-bold text-white truncate">
                  Clinical drivers (SHAP)
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 overflow-y-auto flex-1">
              {loading && (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-400">
                  <Loader2 className="w-10 h-10 animate-spin text-emerald-500" />
                  <p className="text-sm">Loading explainability from /predict/risk…</p>
                </div>
              )}
              {error && !loading && (
                <p className="text-sm text-rose-400 border border-rose-500/30 rounded-xl px-4 py-3 bg-rose-950/30">
                  {error}
                </p>
              )}
              {!loading && !error && data && (
                <>
                  <p className="text-xs text-slate-500 mb-4">
                    Risk {data.risk_score.toFixed(1)} · {data.risk_band}
                  </p>
                  <ul className="space-y-4" aria-label="SHAP contributions">
                    {contributions.map((c) => {
                      const label = rationale[c.feature] ?? c.feature.replace(/_/g, " ");
                      const w = (Math.abs(c.shap_value) / maxAbs) * 100;
                      const increases = c.direction === "increases_risk";
                      return (
                        <li key={c.feature}>
                          <div className="flex justify-between text-xs text-slate-400 mb-1 gap-2">
                            <span className="truncate">{label}</span>
                            <span className={increases ? "text-rose-400" : "text-emerald-400"} tabular-nums>
                              {c.shap_value >= 0 ? "+" : ""}
                              {c.shap_value.toFixed(3)}
                            </span>
                          </div>
                          <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${increases ? "bg-rose-600" : "bg-emerald-500"}`}
                              style={{ width: `${w}%` }}
                            />
                          </div>
                          <span className="sr-only">
                            {increases ? "Increases risk" : "Decreases risk"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[10px] text-slate-600 mt-4 leading-relaxed">
                    Red = increases_risk · Green = decreases_risk (local SHAP on the risk model).
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
