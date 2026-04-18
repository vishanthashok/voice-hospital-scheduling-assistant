import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "motion/react";

type Row = { label: string; value: number; fill: string };

export function ClinicalDrivers({
  contributions,
  clinicalRationale,
}: {
  contributions: Array<{ feature: string; shap_value: number; direction: string }>;
  clinicalRationale: Record<string, string>;
}) {
  const data: Row[] = contributions.map((c) => ({
    label: clinicalRationale[c.feature] ?? c.feature.replace(/_/g, " "),
    value: Math.abs(c.shap_value),
    fill: c.shap_value >= 0 ? "#f43f5e" : "#10b981",
  }));

  if (!data.length) {
    return (
      <p className="text-slate-500 text-sm text-center py-8">Run risk prediction to load SHAP drivers.</p>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1e-6);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Clinical Drivers</h4>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart layout="vertical" data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
            <XAxis type="number" domain={[0, max * 1.1]} hide />
            <YAxis
              type="category"
              dataKey="label"
              width={200}
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "#1e293b" }}
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: "12px",
                fontSize: "12px",
              }}
              formatter={(v: number) => [v.toFixed(3), "|SHAP|"]}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
              {data.map((_, i) => (
                <Cell key={i} fill={data[i].fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-slate-600 mt-2">
        Rose = pushes risk up · Emerald = pushes risk down (local SHAP on scaled features)
      </p>
    </motion.div>
  );
}
