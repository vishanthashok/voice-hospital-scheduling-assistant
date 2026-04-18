import { motion } from "motion/react";
import { Phone, Radio } from "lucide-react";
import type { PatientRecord } from "../../App";

export function TriageSidebar({ queue }: { queue: PatientRecord[] }) {
  return (
    <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-4">
      <div className="flex items-center gap-2 px-1">
        <Radio className="w-4 h-4 text-rose-500 animate-pulse" />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Incoming Triage</h3>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 overflow-hidden">
        {queue.length === 0 ? (
          <p className="p-6 text-sm text-slate-500 text-center">No active voice calls</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {queue.map((p, i) => (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="p-4 flex gap-3 items-start hover:bg-slate-800/40 transition-colors"
              >
                <span className="relative flex h-3 w-3 mt-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white text-sm truncate">{p.name}</p>
                  <p className="text-xs text-slate-500 truncate">{p.condition}</p>
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-400">
                    <Phone className="w-3 h-3 shrink-0" />
                    {p.phone}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-black px-2 py-0.5 rounded-md border ${
                    p.priority === "High"
                      ? "border-orange-700/60 text-orange-600 bg-orange-950/50"
                      : "border-slate-700 text-slate-500"
                  }`}
                >
                  LIVE
                </span>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[10px] text-slate-600 px-1 leading-relaxed">
        Pulse indicates active Twilio session · Charge nurse queue
      </p>
    </aside>
  );
}
