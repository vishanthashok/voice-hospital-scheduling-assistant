import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  RefreshCw,
  ChevronRight,
  X,
  Download,
  Clock,
  User2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

const toneForScore = (score) => {
  if (score == null || Number.isNaN(score))
    return { text: "text-slate-400", chip: "bg-slate-800 text-slate-400", label: "—" };
  if (score >= 75) return { text: "text-rose-300", chip: "bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/40", label: "CRITICAL" };
  if (score >= 40) return { text: "text-orange-300", chip: "bg-orange-500/15 text-orange-200 ring-1 ring-orange-500/30", label: "ELEVATED" };
  return { text: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30", label: "ROUTINE" };
};

function formatTs(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString([], {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function primaryConcern(ev) {
  const drivers = ev.top_drivers || [];
  const first = drivers.find((d) => d && d !== "—");
  if (first) return first;
  const t = (ev.transcript_excerpt || ev.transcript || "").trim();
  return t ? t.slice(0, 64) + (t.length > 64 ? "…" : "") : "—";
}

export function PatientRecords({ apiClient }) {
  const client = apiClient ?? axios;
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | pending | resolved
  const [selected, setSelected] = useState(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await client.get("/history", { params: { limit: 500 } });
      setEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (e) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((e) => {
      if (filter === "pending" && e.resolved) return false;
      if (filter === "resolved" && !e.resolved) return false;
      if (!needle) return true;
      const hay = [
        e.patient_name,
        e.patient_id,
        e.transcript,
        e.transcript_excerpt,
        ...(e.top_drivers || []),
        ...(e.differential || []),
        e.rationale,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [events, query, filter]);

  const stats = useMemo(() => {
    const total = events.length;
    const resolved = events.filter((e) => e.resolved).length;
    const pending = total - resolved;
    const p1 = events.filter((e) => e.priority === "P1").length;
    return { total, resolved, pending, p1 };
  }, [events]);

  const markResolved = async (ev) => {
    if (!ev?.event_id) return;
    try {
      await client.post(`/history/${ev.event_id}/resolve`);
      setEvents((curr) =>
        curr.map((e) => (e.event_id === ev.event_id ? { ...e, resolved: true } : e))
      );
      setSelected((s) => (s?.event_id === ev.event_id ? { ...s, resolved: true } : s));
    } catch (e) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Failed to resolve");
    }
  };

  const downloadFhirFor = async (ev) => {
    try {
      const { data } = await client.post("/export", {
        patient_id: ev.patient_id || ev.call_sid || "demo-patient",
        patient_name: ev.patient_name || null,
        risk_score: ev.risk_score ?? 0,
        priority: ev.priority ?? "P3",
        rationale: ev.rationale ?? "",
        top_drivers: ev.top_drivers ?? [],
        differential: ev.differential ?? [],
        occurrence_datetime: ev.ts,
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/fhir+json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RiskAssessment_${ev.patient_id || ev.event_id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "FHIR export failed");
    }
  };

  return (
    <div className="relative flex flex-1 flex-col p-4 lg:p-6">
      {/* Header + filters */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Patient records</h1>
          <p className="text-xs text-slate-500">
            Longitudinal triage audit log · {stats.total} events · {stats.pending} pending ·{" "}
            {stats.p1} P1
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchHistory()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-slate-600 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symptom, or differential (e.g. “chest pain”)"
            className="w-full rounded-xl border border-slate-800 bg-slate-900/80 py-2.5 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </div>
        <div className="inline-flex rounded-xl border border-slate-800 bg-slate-900/60 p-1 text-xs font-semibold">
          {[
            ["all", "All"],
            ["pending", "Pending"],
            ["resolved", "Resolved"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-lg px-3 py-1.5 transition ${
                filter === id
                  ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
          {String(err)}
        </div>
      )}

      {/* Table */}
      <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/40">
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900/90 backdrop-blur">
              <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="w-36 px-4 py-3 text-left">When</th>
                <th className="w-40 px-4 py-3 text-left">Patient</th>
                <th className="w-24 px-4 py-3 text-left">Acuity</th>
                <th className="w-20 px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Primary concern</th>
                <th className="w-28 px-4 py-3 text-left">Status</th>
                <th className="w-8 px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading && events.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                    <p className="mt-2 text-xs">Loading audit history…</p>
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-slate-500">
                    <FileText className="mx-auto h-6 w-6" />
                    <p className="mt-2 text-xs">No records match. Trigger a triage to populate history.</p>
                  </td>
                </tr>
              )}
              {filtered.map((ev) => {
                const tone = toneForScore(ev.risk_score);
                return (
                  <tr
                    key={ev.event_id ?? `${ev.ts}-${Math.random()}`}
                    onClick={() => setSelected(ev)}
                    className="group cursor-pointer transition hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-slate-600" />
                        {formatTs(ev.ts)}
                      </div>
                    </td>
                    <td className="truncate px-4 py-3">
                      <div className="truncate font-medium text-slate-100">
                        {ev.patient_name || (
                          <span className="text-slate-500 italic">Inbound caller</span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[10px] text-slate-500">
                        {ev.patient_id || ev.call_sid?.slice(0, 10) || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className={`font-mono text-lg font-bold tabular-nums ${tone.text}`}>
                        {ev.risk_score ?? "—"}
                        <span className="text-[10px] font-semibold text-slate-500">/100</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${tone.chip}`}>
                        {ev.priority || "—"}
                      </span>
                    </td>
                    <td className="truncate px-4 py-3 text-slate-300">{primaryConcern(ev)}</td>
                    <td className="px-4 py-3">
                      {ev.resolved ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                          <CheckCircle2 className="h-3 w-3" />
                          Resolved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                          <AlertTriangle className="h-3 w-3" />
                          Pending
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-3 text-slate-500 group-hover:text-slate-200">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over drill-down */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelected(null)}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            />
            <motion.aside
              key={selected.event_id || selected.ts}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 34 }}
              className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-800 bg-slate-950 shadow-2xl"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/95 p-5 backdrop-blur">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                    Triage event
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {selected.patient_name || "Inbound caller"}
                  </h2>
                  <p className="font-mono text-[11px] text-slate-500">
                    {selected.patient_id || selected.call_sid || selected.event_id}
                  </p>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="flex-1 space-y-5 p-5">
                {/* Score card */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Risk index
                      </p>
                      <p
                        className={`mt-1 font-mono text-4xl font-extrabold tabular-nums ${
                          toneForScore(selected.risk_score).text
                        }`}
                      >
                        {selected.risk_score ?? "—"}
                        <span className="text-lg text-slate-600">/100</span>
                      </p>
                      <p className={`mt-1 text-xs font-bold ${toneForScore(selected.risk_score).text}`}>
                        {selected.priority ? `${selected.priority} · ` : ""}
                        {toneForScore(selected.risk_score).label}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Logged
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-300">{formatTs(selected.ts)}</p>
                      <p className="mt-1 text-[10px] uppercase text-slate-600">
                        {selected.channel || "dashboard"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rationale */}
                {selected.rationale && (
                  <section>
                    <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Gemini rationale
                    </h3>
                    <p className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-sm leading-relaxed text-slate-200">
                      {selected.rationale}
                    </p>
                  </section>
                )}

                {/* Drivers + differential */}
                <div className="grid gap-4 md:grid-cols-2">
                  {selected.top_drivers?.length ? (
                    <section>
                      <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Top drivers
                      </h3>
                      <ul className="space-y-1.5">
                        {selected.top_drivers
                          .filter((d) => d && d !== "—")
                          .map((d, i) => (
                            <li
                              key={`${d}-${i}`}
                              className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-200"
                            >
                              <span className="font-mono text-[10px] text-sky-400">{i + 1}</span>
                              {d}
                            </li>
                          ))}
                      </ul>
                    </section>
                  ) : null}
                  {selected.differential?.length ? (
                    <section>
                      <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Rule out
                      </h3>
                      <ul className="space-y-1.5">
                        {selected.differential
                          .filter((d) => d && d !== "—")
                          .map((d, i) => (
                            <li
                              key={`${d}-${i}`}
                              className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-100"
                            >
                              <span className="font-mono text-[10px] text-amber-400">{i + 1}</span>
                              {d}
                            </li>
                          ))}
                      </ul>
                    </section>
                  ) : null}
                </div>

                {/* Transcript */}
                <section>
                  <h3 className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <User2 className="h-3 w-3" />
                    Voice transcript
                  </h3>
                  <div className="max-h-64 overflow-auto rounded-xl border border-slate-700/60 bg-slate-900/70 p-3 text-sm leading-relaxed text-slate-200">
                    {selected.transcript || selected.transcript_excerpt || (
                      <span className="italic text-slate-500">
                        Transcript not recorded for this legacy entry.
                      </span>
                    )}
                  </div>
                </section>
              </div>

              {/* Actions */}
              <footer className="sticky bottom-0 flex flex-wrap gap-3 border-t border-slate-800 bg-slate-950/95 p-5 backdrop-blur">
                <button
                  type="button"
                  onClick={() => void downloadFhirFor(selected)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-400"
                >
                  <Download className="h-4 w-4" />
                  Re-download FHIR
                </button>
                {!selected.resolved && (
                  <button
                    type="button"
                    onClick={() => void markResolved(selected)}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-600/50 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/20"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Mark resolved
                  </button>
                )}
              </footer>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
