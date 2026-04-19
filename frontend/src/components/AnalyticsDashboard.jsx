import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import {
  Activity,
  BarChart3,
  Clock,
  Flame,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_BUCKETS = ["6a", "9a", "12p", "3p", "6p", "9p"];

// Map 24h hour -> one of the 6 buckets above
function hourToBucketIdx(h) {
  if (h < 6) return 5; // fold overnight into 9p
  if (h < 9) return 0;
  if (h < 12) return 1;
  if (h < 15) return 2;
  if (h < 18) return 3;
  if (h < 21) return 4;
  return 5;
}

function heatStyle(intensity) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const e = [16, 185, 129];
  const r = [244, 63, 94];
  const rgb = e.map((c, i) => Math.round(c + (r[i] - c) * clamped));
  return {
    backgroundColor: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    opacity: 0.25 + clamped * 0.75,
  };
}

function StatCard({ icon: Icon, label, value, sub, tone = "sky" }) {
  const tones = {
    sky: "from-sky-500/20 to-sky-600/5 text-sky-300 ring-sky-500/30",
    emerald: "from-emerald-500/20 to-emerald-600/5 text-emerald-300 ring-emerald-500/30",
    amber: "from-amber-500/20 to-amber-600/5 text-amber-300 ring-amber-500/30",
    rose: "from-rose-500/20 to-rose-600/5 text-rose-300 ring-rose-500/30",
  }[tone];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 ring-1 ${tones} border-slate-800/80`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            {label}
          </p>
          <p className="mt-1 font-mono text-3xl font-extrabold tabular-nums text-white">{value}</p>
          {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
        </div>
        <Icon className="h-5 w-5 opacity-80" />
      </div>
    </motion.div>
  );
}

function PriorityBar({ p1, p2, p3 }) {
  const total = p1 + p2 + p3 || 1;
  const pct = (n) => ((n / total) * 100).toFixed(1);
  return (
    <div>
      <div className="flex h-8 overflow-hidden rounded-xl ring-1 ring-slate-700/60">
        <div
          className="flex items-center justify-center bg-gradient-to-r from-rose-600 to-rose-500 text-[11px] font-bold text-white"
          style={{ width: `${pct(p1)}%`, minWidth: p1 ? 40 : 0 }}
          title={`P1: ${p1} (${pct(p1)}%)`}
        >
          {p1 > 0 && `P1 ${p1}`}
        </div>
        <div
          className="flex items-center justify-center bg-gradient-to-r from-amber-500 to-orange-400 text-[11px] font-bold text-white"
          style={{ width: `${pct(p2)}%`, minWidth: p2 ? 40 : 0 }}
          title={`P2: ${p2} (${pct(p2)}%)`}
        >
          {p2 > 0 && `P2 ${p2}`}
        </div>
        <div
          className="flex items-center justify-center bg-gradient-to-r from-emerald-500 to-emerald-400 text-[11px] font-bold text-white"
          style={{ width: `${pct(p3)}%`, minWidth: p3 ? 40 : 0 }}
          title={`P3: ${p3} (${pct(p3)}%)`}
        >
          {p3 > 0 && `P3 ${p3}`}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
        <span className="text-rose-400/90">Emergent {pct(p1)}%</span>
        <span className="text-orange-400/90">Urgent {pct(p2)}%</span>
        <span className="text-emerald-400/90">Routine {pct(p3)}%</span>
      </div>
    </div>
  );
}

export function AnalyticsDashboard({ apiClient }) {
  const client = apiClient ?? axios;
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await client.get("/history", { params: { limit: 1000 } });
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (e) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    const total = events.length;
    const p1 = events.filter((e) => e.priority === "P1").length;
    const p2 = events.filter((e) => e.priority === "P2").length;
    const p3 = events.filter((e) => e.priority === "P3").length;
    const validScores = events.map((e) => e.risk_score).filter((s) => typeof s === "number");
    const avg =
      validScores.length > 0
        ? validScores.reduce((a, b) => a + b, 0) / validScores.length
        : 0;
    const p1Rate = total ? (p1 / total) * 100 : 0;
    const minutesSaved = total * 5;

    // Symptom frequency — normalize drivers to lowercase tokens
    const freq = new Map();
    for (const e of events) {
      for (const d of e.top_drivers || []) {
        if (!d || d === "—") continue;
        const key = d.trim();
        freq.set(key, (freq.get(key) || 0) + 1);
      }
    }
    const topSymptoms = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Heatmap — count events per (day-of-week, hour-bucket)
    const grid = Array.from({ length: HOUR_BUCKETS.length }, () =>
      Array.from({ length: DAY_LABELS.length }, () => 0)
    );
    let maxCell = 0;
    for (const e of events) {
      const ts = e.ts ? new Date(e.ts) : null;
      if (!ts || Number.isNaN(ts.getTime())) continue;
      const d = ts.getDay();
      const h = ts.getHours();
      const row = hourToBucketIdx(h);
      grid[row][d] += 1;
      if (grid[row][d] > maxCell) maxCell = grid[row][d];
    }

    return {
      total,
      p1,
      p2,
      p3,
      avg,
      p1Rate,
      minutesSaved,
      topSymptoms,
      grid,
      maxCell,
    };
  }, [events]);

  return (
    <div className="flex flex-1 flex-col p-4 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Hospital analytics</h1>
          <p className="text-xs text-slate-500">
            Operational intelligence derived from the Gemini audit log
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
          {String(err)}
        </div>
      )}

      {/* Stat cards */}
      <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Users}
          tone="sky"
          label="Total triage volume"
          value={metrics.total}
          sub="All time · Gemini-scored events"
        />
        <StatCard
          icon={TrendingUp}
          tone="emerald"
          label="Average risk score"
          value={metrics.avg ? metrics.avg.toFixed(1) : "—"}
          sub="Pool health · 0–100"
        />
        <StatCard
          icon={Clock}
          tone="amber"
          label="Est. time saved"
          value={`${metrics.minutesSaved}m`}
          sub={`${(metrics.minutesSaved / 60).toFixed(1)} h vs manual intake`}
        />
        <StatCard
          icon={ShieldAlert}
          tone="rose"
          label="Critical P1 rate"
          value={`${metrics.p1Rate.toFixed(1)}%`}
          sub={`${metrics.p1} flagged emergent`}
        />
      </section>

      {/* Distribution + symptoms */}
      <section className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <BarChart3 className="h-4 w-4 text-sky-400" />
                Priority distribution
              </h2>
              <p className="text-[11px] text-slate-500">
                P1 = emergent · P2 = urgent · P3 = routine
              </p>
            </div>
            <span className="font-mono text-xs text-slate-500">n = {metrics.total}</span>
          </div>
          <div className="mt-4">
            {metrics.total === 0 && !loading ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No triage events yet. Trigger a triage to populate analytics.
              </p>
            ) : loading && metrics.total === 0 ? (
              <div className="py-10 text-center text-slate-500">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </div>
            ) : (
              <PriorityBar p1={metrics.p1} p2={metrics.p2} p3={metrics.p3} />
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-amber-400" />
            Top symptoms
          </h2>
          <p className="text-[11px] text-slate-500">Most frequent Gemini drivers</p>
          <ol className="mt-3 space-y-2">
            {metrics.topSymptoms.length === 0 && (
              <li className="text-xs text-slate-500">—</li>
            )}
            {metrics.topSymptoms.map(([label, count], i) => {
              const pct = metrics.total ? (count / metrics.total) * 100 : 0;
              return (
                <li key={label}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-slate-200">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-slate-800 font-mono text-[9px] text-sky-400">
                        {i + 1}
                      </span>
                      {label}
                    </span>
                    <span className="font-mono text-slate-500">
                      {count} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Historical load heatmap */}
      <section className="mt-4 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Flame className="h-4 w-4 text-orange-400" />
              Historical call load
            </h2>
            <p className="text-[11px] text-slate-500">
              Inbound triage volume by day of week × time of day
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500">peak = {metrics.maxCell}</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <div
            className="grid min-w-[480px] gap-1.5"
            style={{ gridTemplateColumns: `60px repeat(${DAY_LABELS.length}, minmax(0,1fr))` }}
          >
            <div />
            {DAY_LABELS.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-500"
              >
                {d}
              </div>
            ))}
            {HOUR_BUCKETS.map((label, ri) => (
              <div key={label} style={{ display: "contents" }}>
                <div className="flex items-center font-mono text-[10px] text-slate-500">
                  {label}
                </div>
                {DAY_LABELS.map((_, ci) => {
                  const v = metrics.grid[ri][ci];
                  const intensity = metrics.maxCell ? v / metrics.maxCell : 0;
                  return (
                    <div
                      key={`${ri}-${ci}`}
                      title={`${DAY_LABELS[ci]} ${label} · ${v} calls`}
                      style={heatStyle(intensity)}
                      className="flex aspect-square min-h-[28px] items-center justify-center rounded-lg text-[10px] font-bold text-white/90 ring-1 ring-black/10"
                    >
                      {v || ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
