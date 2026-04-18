import { motion } from "motion/react";
import { CalendarClock, Cpu } from "lucide-react";

type Slot = {
  slot_id?: string;
  day?: string;
  time?: string;
  doctor?: string;
  doctor_load?: string;
  score?: number;
  reasoning?: Record<string, unknown>;
};

export function SuggestedSlotsPanel({
  slots,
  patientSummary,
}: {
  slots: Slot[];
  patientSummary?: Record<string, unknown>;
}) {
  const scheduler = (patientSummary?.scheduler as string) ?? "OR-Tools CP-SAT";
  const opt =
    "Optimized to minimize wait time × clinical risk, with 2-hour window load caps for high-acuity patients.";

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
      <div className="flex items-start gap-3 mb-6">
        <div className="p-2 rounded-xl bg-slate-800 border border-slate-700">
          <CalendarClock className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h4 className="text-lg font-bold text-white">Suggested Slots</h4>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5" />
            <span>{scheduler}</span>
          </p>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">{opt}</p>
        </div>
      </div>
      <ul className="space-y-3">
        {slots.map((slot, i) => {
          const r = slot.reasoning ?? {};
          const wait = r.objective_wait_hours as number | undefined;
          const cost = r.objective_total_cost as number | undefined;
          const win = r.window_key as string | undefined;
          const existing = r.existing_high_risk_in_window as number | undefined;
          return (
            <motion.li
              key={String(slot.slot_id ?? i)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`rounded-2xl border p-4 ${
                i === 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-slate-950/50"
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className="font-bold text-white">
                    {slot.day} · {slot.time}
                  </p>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {slot.doctor} · load {slot.doctor_load}
                  </p>
                </div>
                {i === 0 && (
                  <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                    Best fit
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                {wait != null && (
                  <>
                    <span className="text-slate-400">Minimal wait proxy:</span> {wait.toFixed(1)}h composite
                    {cost != null && (
                      <>
                        {" "}
                        · <span className="text-slate-400">objective</span> {cost.toFixed(2)}
                      </>
                    )}
                  </>
                )}
                {win != null && (
                  <>
                    <br />
                    <span className="text-slate-600">Window {win}</span>
                    {existing != null && (
                      <span className="text-slate-600"> · {existing}/3 high-risk booked (burnout cap)</span>
                    )}
                  </>
                )}
              </p>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
