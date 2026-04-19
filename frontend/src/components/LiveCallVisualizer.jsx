import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Phone, PhoneCall, Radio, AlertTriangle } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 60_000,
});

/**
 * Subscribes to FastAPI SSE `/voice/stream/sse` and shows LIVE call + transcript stream.
 * Twilio <Gather speech> sends final text; backend replays it char-by-char for the “typing” effect.
 */
export function LiveCallVisualizer({ onLiveChange }) {
  const [connected, setConnected] = useState(false);
  const [live, setLive] = useState(false);
  const [callMeta, setCallMeta] = useState(null);
  const [transcript, setTranscript] = useState("");
  const [liveTriage, setLiveTriage] = useState(null);
  const [outreachPhone, setOutreachPhone] = useState("");
  const [outreachBusy, setOutreachBusy] = useState(false);
  const [outreachMsg, setOutreachMsg] = useState(null);
  const [browserMsg, setBrowserMsg] = useState(null);
  const [browserBusy, setBrowserBusy] = useState(false);
  const esRef = useRef(null);
  const deviceRef = useRef(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/voice/stream/sse`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "call_started") {
          setLive(true);
          onLiveChange?.(true);
          setCallMeta({ sid: data.call_sid, from: data.from, to: data.to });
          setTranscript("");
          setLiveTriage(null);
        }
        if (data.type === "transcript_char") {
          setTranscript(data.accumulated ?? "");
        }
        if (data.type === "triage_complete") {
          setLiveTriage({
            event_id: data.event_id,
            risk_score: data.risk_score,
            priority: data.priority,
            rationale: data.rationale,
            top_drivers: Array.isArray(data.top_drivers) ? data.top_drivers : [],
            source: data.source,
          });
        }
        if (data.type === "triage_error") {
          setLiveTriage({
            error: true,
            detail: data.detail || "Gemini call failed",
          });
        }
        if (data.type === "call_ended" || data.type === "stt_empty") {
          setLive(false);
          onLiveChange?.(false);
        }
      } catch {
        /* ignore parse */
      }
    };
    return () => {
      es.close();
    };
  }, [onLiveChange]);

  const clickToCall = async () => {
    const to = outreachPhone.trim();
    if (!to.startsWith("+")) {
      setOutreachMsg("Use E.164 format, e.g. +15551234567");
      return;
    }
    setOutreachBusy(true);
    setOutreachMsg(null);
    try {
      const { data } = await api.post("/voice/click-to-call", { to });
      setOutreachMsg(`Calling… Call SID ${data.call_sid}`);
    } catch (e) {
      setOutreachMsg(e?.response?.data?.detail ?? e?.message ?? "Call failed");
    } finally {
      setOutreachBusy(false);
    }
  };

  const connectBrowserPhone = useCallback(async () => {
    setBrowserBusy(true);
    setBrowserMsg(null);
    try {
      const { data: tok } = await api.get("/voice/client-token");
      const { Device } = await import("@twilio/voice-sdk");
      if (deviceRef.current) {
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
      const device = new Device(tok.token, { logLevel: "error" });
      device.on("error", (e) => setBrowserMsg(String(e?.message ?? e)));
      device.on("registered", () => setBrowserMsg("Browser phone ready — enter number and place call."));
      await device.register();
      deviceRef.current = device;
    } catch (e) {
      setBrowserMsg(
        e?.response?.data?.detail ??
          e?.message ??
          "Set TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_VOICE_APP_SID for browser calling."
      );
    } finally {
      setBrowserBusy(false);
    }
  }, []);

  const browserDial = async () => {
    const to = outreachPhone.trim();
    if (!to.startsWith("+")) {
      setBrowserMsg("E.164 number required (+1…)");
      return;
    }
    const device = deviceRef.current;
    if (!device) {
      setBrowserMsg("Connect browser phone first.");
      return;
    }
    try {
      await device.connect({ params: { To: to } });
      setBrowserMsg("Outbound call starting…");
    } catch (e) {
      setBrowserMsg(String(e?.message ?? e));
    }
  };

  return (
    <div className="mx-6 mt-4 space-y-4">
      {/* Live call strip */}
      <motion.div
        layout
        className={`overflow-hidden rounded-2xl border shadow-sm transition-colors ${
          live
            ? "border-sky-500/50 bg-slate-900/90 shadow-lg shadow-sky-500/10"
            : "border-slate-800 bg-slate-900/50"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio
              className={`h-4 w-4 ${connected ? "text-emerald-400" : "text-slate-600"}`}
              aria-hidden
            />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Voice link</span>
          </div>
          <AnimatePresence>
            {live && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="inline-flex items-center gap-2 rounded-full bg-sky-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wide text-sky-300 ring-1 ring-sky-500/40"
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-50" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-400" />
                </span>
                Live call in progress
              </motion.span>
            )}
          </AnimatePresence>
          {callMeta?.sid && (
            <span className="font-mono text-[10px] text-slate-500">
              {callMeta.sid.slice(0, 12)}…
            </span>
          )}
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Live transcript</p>
            <div className="mt-2 min-h-[100px] rounded-xl border border-slate-800 bg-slate-950/60 p-3 font-mono text-sm leading-relaxed text-slate-200">
              {transcript || (live ? <span className="text-slate-600">Listening…</span> : <span className="text-slate-600">Waiting for inbound Twilio call…</span>)}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Gemini triage (from call)</p>
            {liveTriage?.error ? (
              <div className="mt-2 rounded-xl border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
                Gemini error: {liveTriage.detail}
              </div>
            ) : liveTriage ? (
              <div className="mt-2 space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                      liveTriage.risk_score >= 75
                        ? "bg-rose-500/20 text-rose-300"
                        : liveTriage.risk_score >= 40
                          ? "bg-orange-500/15 text-orange-200"
                          : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {liveTriage.priority} · {Math.round(liveTriage.risk_score)}/100
                  </span>
                  <span className="text-[10px] text-slate-500">{liveTriage.source}</span>
                </div>
                <p className="text-slate-300">{liveTriage.rationale}</p>
                {liveTriage.top_drivers?.length ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {liveTriage.top_drivers.map((d, i) => (
                      <span
                        key={`${d}-${i}`}
                        className="rounded-md border border-slate-700/70 bg-slate-900/70 px-2 py-0.5 text-[10px] font-medium text-slate-200"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs text-slate-600">Triage appears here after the caller finishes speaking.</p>
            )}
          </div>
        </div>
      </motion.div>

      {/* Outreach + optional browser SDK */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm">
        <div className="flex items-center gap-2 text-slate-200">
          <AlertTriangle className="h-4 w-4 text-rose-400" />
          <span className="text-sm font-semibold">Emergency patient outreach</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Server-side outbound (Twilio REST). Requires <code className="text-slate-400">PUBLIC_BASE_URL</code> for webhooks.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="text-[10px] font-medium uppercase text-slate-500">E.164 phone</label>
            <input
              type="tel"
              value={outreachPhone}
              onChange={(e) => setOutreachPhone(e.target.value)}
              placeholder="+15551234567"
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
          <button
            type="button"
            onClick={() => void clickToCall()}
            disabled={outreachBusy}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-sky-500/20 hover:bg-sky-400 disabled:opacity-50"
          >
            {outreachBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            Click-to-call
          </button>
        </div>
        {outreachMsg && <p className="mt-2 text-xs text-slate-400">{outreachMsg}</p>}

        <div className="mt-6 border-t border-slate-800 pt-4">
          <p className="text-xs font-medium text-slate-400">Browser dial (Twilio Voice SDK)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void connectBrowserPhone()}
              disabled={browserBusy}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              {browserBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
              Connect browser phone
            </button>
            <button
              type="button"
              onClick={() => void browserDial()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Dial from browser
            </button>
          </div>
          {browserMsg && <p className="mt-2 text-xs text-amber-200/90">{browserMsg}</p>}
        </div>
      </div>
    </div>
  );
}
