import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  Calendar,
  CheckCircle2,
  Download,
  Flame,
  Loader2,
  Stethoscope,
  Wifi,
} from "lucide-react";

/** Dev: Vite proxies /triage, /export, /health → FastAPI. Prod: set `VITE_API_BASE`. */
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const client = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 120_000,
});

const MOCK_PATIENTS = [
  {
    id: "P001",
    name: "Jordan Ellis",
    transcript:
      "I've had tightness in my chest since this morning and some shortness of breath when I walk upstairs.",
  },
  {
    id: "P002",
    name: "Sam Rivera",
    transcript:
      "Routine follow-up for hypertension; meds are fine, just need a refill and vitals check.",
  },
  {
    id: "P003",
    name: "Taylor Chen",
    transcript:
      "Fever 101 for two days, sore throat, worse when swallowing. No trouble breathing.",
  },
  {
    id: "P004",
    name: "Morgan Blake",
    transcript:
      "Chronic back pain flared after lifting; pain is sharp but I can still move my legs fine.",
  },
  {
    id: "P005",
    name: "Riley Park",
    transcript:
      "Anxiety and palpitations after coffee; feels like heart racing but no chest pain.",
  },
];

/** Synthetic clinic load grid (demo — not live occupancy). */
const HEAT_ROWS = ["9a", "10a", "11a", "1p", "2p", "3p"];
const HEAT_COLS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function hashLoad(seed, r, c) {
  let x = seed + r * 17 + c * 31;
  x = (x * 1103515245 + 12345) & 0x7fffffff;
  return x % 101;
}

/** Mock CP-SAT–style ranked slots (deterministic from risk). */
function suggestedSlots(riskScore) {
  const base = [
    { day: "Tuesday", time: "10:30 AM", doctor: "Dr. Patel", score: 0.92 },
    { day: "Wednesday", time: "2:00 PM", doctor: "Dr. Vasquez", score: 0.88 },
    { day: "Friday", time: "9:00 AM", doctor: "Dr. Chen", score: 0.81 },
  ];
  const urgency = riskScore >= 70 ? "earliest feasible" : "balanced wait";
  return base.map((s, i) => ({
    ...s,
    label: `${s.day} · ${s.time} · ${s.doctor}`,
    note: `OR-Tools CP-SAT (${urgency}) · rank ${i + 1}`,
  }));
}

function badgeForRisk(score) {
  if (score >= 75) return { label: "P1", bg: "#FEE2E2", fg: "#991B1B", border: "#FECACA" };
  if (score >= 45) return { label: "P2", bg: "#FEF3C7", fg: "#92400E", border: "#FDE68A" };
  return { label: "P3", bg: "#D1FAE5", fg: "#065F46", border: "#A7F3D0" };
}

export default function App() {
  const [selected, setSelected] = useState(MOCK_PATIENTS[0]);
  const [triage, setTriage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [resolved, setResolved] = useState({});
  const [health, setHealth] = useState(null);

  const heatSeed = useMemo(
    () => Math.floor((triage?.risk_score ?? 40) * 100) % 1000,
    [triage?.risk_score]
  );

  const runTriage = useCallback(async (patient) => {
    setLoading(true);
    setErr(null);
    setTriage(null);
    try {
      const { data } = await client.post("/triage", {
        voice_transcript: patient.transcript,
        patient_id: patient.id,
        patient_name: patient.name,
      });
      setTriage(data);
    } catch (e) {
      setErr(e?.response?.data?.detail ?? e?.message ?? "Triage failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runTriage(selected);
  }, [selected, runTriage]);

  useEffect(() => {
    let alive = true;
    client
      .get("/health")
      .then((r) => {
        if (alive) setHealth(r.data);
      })
      .catch(() => {
        if (alive) setHealth({ status: "offline" });
      });
    return () => {
      alive = false;
    };
  }, [triage]);

  const slots = useMemo(
    () => suggestedSlots(triage?.risk_score ?? 40),
    [triage?.risk_score]
  );

  const downloadFhir = async () => {
    if (!triage) return;
    try {
      const { data } = await client.post("/export", {
        patient_id: selected.id,
        patient_name: selected.name,
        risk_score: triage.risk_score,
        priority: triage.priority,
        clinical_rationale: triage.clinical_rationale,
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/fhir+json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `RiskAssessment_${selected.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.message ?? "Export failed");
    }
  };

  const markResolved = () => {
    setResolved((r) => ({ ...r, [selected.id]: true }));
  };

  const badge = triage ? badgeForRisk(triage.risk_score) : { label: "—", bg: "#F3F4F6", fg: "#6B7280", border: "#E5E7EB" };

  return (
    <div style={styles.shell}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Inter, system-ui, -apple-system, sans-serif; background: #f2f2f7; color: #1c1c1e; }
      `}</style>

      <header style={styles.header}>
        <div style={styles.brand}>
          <Stethoscope style={{ width: 28, height: 28, color: "#007aff" }} />
          <div>
            <div style={styles.brandKicker}>MediVoice AI 2.0</div>
            <h1 style={styles.title}>Patient–Doctor Link</h1>
          </div>
        </div>
        <div style={styles.headerActions}>
          <button type="button" style={styles.btnGhost} onClick={() => void downloadFhir()} disabled={!triage || loading}>
            <Download size={16} /> Download FHIR
          </button>
          <button type="button" style={styles.btnPrimary} onClick={markResolved} disabled={!triage}>
            <CheckCircle2 size={16} /> Mark resolved
          </button>
          <button
            type="button"
            style={styles.btnGhost}
            onClick={() => {
              client.get("/health").then((r) => setHealth(r.data)).catch(() => setHealth({ status: "offline" }));
            }}
          >
            <Wifi size={16} /> System status
          </button>
        </div>
      </header>

      {err && (
        <div style={styles.errorBanner} role="alert">
          {String(err)}
        </div>
      )}

      <div style={styles.grid}>
        {/* Col 1 — Queue */}
        <section style={styles.card}>
          <h2 style={styles.h2}>Incoming</h2>
          <p style={styles.muted}>Voice intake queue — select a patient</p>
          <ul style={styles.queue}>
            {MOCK_PATIENTS.map((p) => {
              const active = p.id === selected.id;
              const done = resolved[p.id];
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    style={{
                      ...styles.queueItem,
                      ...(active ? styles.queueItemActive : {}),
                      opacity: done ? 0.55 : 1,
                    }}
                  >
                    <div style={styles.queueRow}>
                      <span style={styles.pName}>{p.name}</span>
                      {p.id === selected.id && triage && (
                        <span
                          style={{
                            ...styles.badge,
                            background: badge.bg,
                            color: badge.fg,
                            borderColor: badge.border,
                          }}
                        >
                          {triage.priority} · {Math.round(triage.risk_score)}
                        </span>
                      )}
                    </div>
                    <span style={styles.pId}>{p.id}</span>
                    {done && <span style={styles.resolvedTag}>Resolved</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Col 2 — Detail */}
        <section style={{ ...styles.card, position: "relative", minHeight: 480 }}>
          <AnimatePresence mode="wait">
            {loading && (
              <motion.div
                key="load"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={styles.overlay}
              >
                <Loader2 className="spin" size={40} color="#007aff" />
                <p style={styles.overlayText}>Gemini orchestrator…</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.9s linear infinite; }`}</style>
              </motion.div>
            )}
          </AnimatePresence>

          <h2 style={styles.h2}>{selected.name}</h2>
          <p style={styles.muted}>{selected.id}</p>

          <div style={styles.block}>
            <div style={styles.label}>Voice transcript</div>
            <p style={styles.bodyText}>{selected.transcript}</p>
          </div>

          <div style={styles.block}>
            <div style={styles.label}>Gemini reasoning</div>
            <p style={styles.bodyText}>{triage?.clinical_rationale ?? "—"}</p>
          </div>

          <div style={styles.block}>
            <div style={styles.label}>Next steps</div>
            <p style={styles.bodyText}>{triage?.next_steps ?? "—"}</p>
            {triage?.source && (
              <p style={styles.tiny}>Source: {triage.source}</p>
            )}
          </div>
        </section>

        {/* Col 3 — Heatmap + slots */}
        <section style={styles.card}>
          <h2 style={styles.h2}>
            <Flame size={18} style={{ verticalAlign: "-3px", marginRight: 6 }} />
            Clinic load
          </h2>
          <p style={styles.muted}>Synthetic occupancy heat — demo only</p>
          <div style={styles.heatWrap}>
            <div style={styles.heatGrid}>
              <div />
              {HEAT_COLS.map((d) => (
                <div key={d} style={styles.heatHead}>
                  {d}
                </div>
              ))}
              {HEAT_ROWS.map((t, ri) => (
                <div key={t} style={{ display: "contents" }}>
                  <div style={styles.heatTime}>{t}</div>
                  {HEAT_COLS.map((_, ci) => {
                    const v = hashLoad(heatSeed, ri, ci);
                    const bg =
                      v < 30 ? "#D1FAE5" : v < 60 ? "#FEF3C7" : v < 85 ? "#FECACA" : "#FCA5A5";
                    return (
                      <div key={`${t}-${ci}`} style={{ ...styles.heatCell, background: bg }} title={`Load ${v}`}>
                        {v}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <h3 style={{ ...styles.h2, marginTop: 24, fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={16} />
            Suggested slots
          </h3>
          <p style={styles.muted}>Ranked by OR-Tools CP-SAT (demo schedule)</p>
          <ul style={styles.slotList}>
            {slots.map((s) => (
              <li key={s.label} style={styles.slotItem}>
                <div style={styles.slotTitle}>{s.label}</div>
                <div style={styles.slotNote}>{s.note}</div>
              </li>
            ))}
          </ul>

          <div style={styles.statusCard}>
            <Activity size={16} />
            <div>
              <div style={styles.statusLabel}>API</div>
              <pre style={styles.pre}>{JSON.stringify(health ?? {}, null, 0)}</pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const styles = {
  shell: { minHeight: "100vh", padding: "24px 28px 48px" },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 24,
  },
  brand: { display: "flex", alignItems: "center", gap: 14 },
  brandKicker: { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "#8e8e93", textTransform: "uppercase" },
  title: { margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" },
  headerActions: { display: "flex", flexWrap: "wrap", gap: 10 },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 12,
    border: "none",
    background: "#007aff",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  btnGhost: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid #d1d1d6",
    background: "#fff",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  errorBanner: {
    background: "#FEF2F2",
    border: "1px solid #FECACA",
    color: "#991B1B",
    padding: "12px 16px",
    borderRadius: 12,
    marginBottom: 16,
    fontSize: 14,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(260px, 1fr) minmax(320px, 1.2fr) minmax(280px, 1fr)",
    gap: 20,
    alignItems: "start",
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: "20px 20px 24px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
    border: "1px solid #e5e5ea",
  },
  h2: { margin: "0 0 4px 0", fontSize: 17, fontWeight: 700 },
  muted: { margin: "0 0 16px 0", fontSize: 13, color: "#8e8e93" },
  queue: { listStyle: "none", margin: 0, padding: 0, maxHeight: 520, overflowY: "auto" },
  queueItem: {
    width: "100%",
    textAlign: "left",
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #e5e5ea",
    background: "#fafafa",
    marginBottom: 10,
    cursor: "pointer",
  },
  queueItemActive: {
    borderColor: "#007aff",
    background: "#f0f7ff",
    boxShadow: "0 0 0 1px #007aff22",
  },
  queueRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  pName: { fontWeight: 600, fontSize: 14 },
  pId: { fontSize: 12, color: "#8e8e93", marginTop: 4, display: "block" },
  resolvedTag: { fontSize: 11, color: "#059669", fontWeight: 600, marginTop: 6, display: "inline-block" },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    padding: "4px 8px",
    borderRadius: 8,
    border: "1px solid",
  },
  block: { marginBottom: 20 },
  label: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#8e8e93",
    marginBottom: 8,
  },
  bodyText: { margin: 0, fontSize: 15, lineHeight: 1.55, color: "#3a3a3c" },
  tiny: { margin: "8px 0 0", fontSize: 12, color: "#aeaeb2" },
  overlay: {
    position: "absolute",
    inset: 0,
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(8px)",
    borderRadius: 20,
  },
  overlayText: { marginTop: 12, fontWeight: 600, color: "#3a3a3c" },
  heatWrap: { overflowX: "auto" },
  heatGrid: {
    display: "grid",
    gridTemplateColumns: "48px repeat(5, minmax(0, 1fr))",
    gap: 6,
    minWidth: 280,
  },
  heatHead: { fontSize: 10, fontWeight: 700, textAlign: "center", color: "#8e8e93" },
  heatTime: { fontSize: 11, color: "#8e8e93", display: "flex", alignItems: "center" },
  heatCell: {
    borderRadius: 8,
    minHeight: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 10,
    fontWeight: 700,
    color: "#1c1c1e88",
    border: "1px solid #0000000a",
  },
  slotList: { listStyle: "none", margin: 0, padding: 0 },
  slotItem: {
    padding: "12px 14px",
    borderRadius: 14,
    background: "#f2f2f7",
    marginBottom: 10,
    border: "1px solid #e5e5ea",
  },
  slotTitle: { fontSize: 13, fontWeight: 600 },
  slotNote: { fontSize: 11, color: "#8e8e93", marginTop: 4 },
  statusCard: {
    marginTop: 20,
    padding: 12,
    borderRadius: 14,
    background: "#f9fafb",
    border: "1px solid #e5e7eb",
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
  },
  statusLabel: { fontSize: 11, fontWeight: 600, color: "#6b7280" },
  pre: { margin: "4px 0 0", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all" },
};
