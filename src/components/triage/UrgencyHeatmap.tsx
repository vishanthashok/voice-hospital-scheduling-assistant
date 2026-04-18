import { Fragment } from "react";
import { motion } from "motion/react";
import { Flame } from "lucide-react";
import type { PatientRecord } from "../../App";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const TIME_LABELS = ["9a", "10a", "11a", "1p", "2p", "3p"] as const;

/** Map schedule grid keys to approximate heat from patient risk in that cell */
export function buildHeatFromSchedule(
  scheduleSlots: Array<Record<string, string | null>>,
  getPatient: (id: string | null) => PatientRecord | undefined
): number[][] {
  const heat: number[][] = TIME_LABELS.map(() => DAYS.map(() => 0));

  scheduleSlots.forEach((row, ti) => {
    DAYS.forEach((_, di) => {
      const key = ["mon", "tue", "wed", "thu", "fri"][di] as keyof typeof row;
      const pid = row[key];
      const pat = getPatient(pid);
      if (pat) heat[ti][di] = Math.min(100, pat.riskScore * 0.85 + (pat.priority === "High" ? 25 : 0));
    });
  });

  return heat;
}

function cellColor(v: number): string {
  if (v < 25) return "bg-emerald-500/25 border-emerald-500/20";
  if (v < 50) return "bg-amber-500/20 border-amber-500/25";
  if (v < 75) return "bg-rose-600/25 border-rose-600/30";
  return "bg-orange-800/40 border-orange-700/50"; // burnt orange — hottest / UT accent
}

export function UrgencyHeatmap({ heat }: { heat: number[][] }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Flame className="w-5 h-5 text-orange-700" />
        <h4 className="text-lg font-bold text-white">Clinical load heatmap</h4>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Darker = more high-risk minutes stacked in that block — nudge scheduling to cooler windows when OR-Tools
        flags burnout.
      </p>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-1.5 min-w-[300px]"
          style={{ gridTemplateColumns: `64px repeat(${DAYS.length}, minmax(0, 1fr))` }}
        >
          <div />
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-black text-slate-500 uppercase py-1">
              {d}
            </div>
          ))}
          {TIME_LABELS.map((t, ti) => (
            <Fragment key={t}>
              <div className="text-xs font-mono text-slate-500 flex items-center">{t}</div>
              {DAYS.map((_, di) => {
                const v = heat[ti]?.[di] ?? 0;
                return (
                  <motion.div
                    key={`${t}-${di}`}
                    initial={{ opacity: 0.7 }}
                    whileHover={{ scale: 1.04 }}
                    className={`aspect-square rounded-lg border flex items-center justify-center text-[10px] font-bold min-h-[36px] ${cellColor(v)}`}
                    title={`Load index ${Math.round(v)}`}
                  >
                    <span className={v >= 75 ? "text-orange-200" : "text-slate-400"}>{Math.round(v)}</span>
                  </motion.div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 mt-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-500/40 border border-emerald-500/30" /> Low
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-rose-600/30 border border-rose-600/30" /> High
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-orange-800/50 border border-orange-700/50" /> Critical / overload
        </span>
      </div>
    </div>
  );
}
