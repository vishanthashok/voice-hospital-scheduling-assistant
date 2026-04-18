import { motion } from "motion/react";

export function RiskGauge({
  value,
  band,
}: {
  value: number;
  band: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (pct / 100) * circumference;
  const critical = band === "Critical";
  const high = band === "High" || critical;
  const pending = band === "Pending";

  const stroke = pending
    ? "#64748b"
    : critical
      ? "#c2410c"
      : high
        ? "#e11d48"
        : pct < 35
          ? "#10b981"
          : "#f59e0b";

  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#1e293b" strokeWidth="8" />
        <motion.circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={stroke}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-white tabular-nums">{value.toFixed(0)}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{band}</span>
      </div>
      {critical && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-black uppercase text-orange-700 tracking-tighter">
          UT · critical
        </span>
      )}
    </div>
  );
}
