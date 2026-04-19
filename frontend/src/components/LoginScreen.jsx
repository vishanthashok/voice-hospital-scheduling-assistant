import { useState } from "react";
import { motion } from "framer-motion";
import { Stethoscope, ShieldCheck, ArrowRight, Eye, EyeOff } from "lucide-react";

const SESSION_KEY = "medivoice:session";

/**
 * Demo-only login gate. Real deployment would wire this to Firebase / Auth0.
 * Any non-empty name + PIN 1234 lets the user through. Stored in localStorage
 * so a refresh doesn't log them out in the middle of a demo.
 */
export function LoginScreen({ onAuthed }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState("Attending · ED");
  const [showPin, setShowPin] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e?.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("Enter your clinician name.");
    if (pin.trim() !== "1234") return setErr("Demo PIN is 1234.");
    setBusy(true);
    await new Promise((r) => setTimeout(r, 400));
    const session = {
      name: name.trim(),
      role,
      loggedInAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage disabled — still authed for this tab */
    }
    onAuthed(session);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 text-slate-100">
      {/* Ambient gradient blobs */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0)_0%,rgba(2,6,23,0.7)_70%)]" />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
        className="relative z-10 grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/60 shadow-2xl shadow-black/40 backdrop-blur-xl md:grid-cols-2"
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-sky-500/90 via-indigo-500/50 to-transparent"
          aria-hidden
        />
        {/* Left — brand panel */}
        <div className="relative hidden flex-col justify-between bg-gradient-to-br from-sky-900/40 via-slate-900 to-indigo-900/40 p-10 md:flex">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40">
                <Stethoscope className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">MediVoice</p>
                <p className="text-[11px] uppercase tracking-widest text-slate-500">Clinical triage | v2.0</p>
              </div>
            </div>
            <h1 className="mt-10 text-3xl font-semibold leading-tight text-white">
              Your second set of ears
              <br />
              <span className="text-sky-300">on every call.</span>
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              Gemini-powered triage scores every incoming call in seconds, ranks
              your queue by acuity, and ships the result as FHIR the moment the
              caller hangs up.
            </p>
          </div>
          <div className="mt-12 space-y-3 text-xs text-slate-400">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>HIPAA-aware · audit log is append-only JSONL on disk</span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>Zero-retention: transcripts never leave your Gemini tenant</span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>Twilio Voice + SSE for sub-second dashboard updates</span>
            </div>
          </div>
        </div>

        {/* Right — form */}
        <form onSubmit={submit} className="flex flex-col justify-center gap-5 p-8 md:p-10">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-400">Sign in</p>
            <h2 className="mt-1 text-2xl font-semibold text-white">Welcome back, clinician</h2>
            <p className="mt-1 text-xs text-slate-500">
              Evaluation access: PIN <span className="font-mono text-slate-300">1234</span>. Enter any
              clinician display name.
            </p>
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Clinician name
            </span>
            <input
              type="text"
              autoFocus
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dr. Morgan Pierce"
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Role
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 focus:border-sky-500/60 focus:outline-none"
            >
              <option>Attending · ED</option>
              <option>Resident · ED</option>
              <option>Triage Nurse</option>
              <option>Charge Nurse</option>
              <option>Hospital Admin</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              PIN
            </span>
            <div className="relative mt-1.5">
              <input
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4-digit PIN"
                className="w-full rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 pr-10 font-mono tracking-[0.4em] text-slate-100 placeholder:text-slate-700 focus:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:text-slate-200"
                aria-label={showPin ? "Hide PIN" : "Show PIN"}
              >
                {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {err && (
            <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              {err}
            </p>
          )}

          <motion.button
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Authenticating…" : "Enter dashboard"}
            <ArrowRight className="h-4 w-4" />
          </motion.button>

          <p className="text-center text-[10px] text-slate-600">
            Evaluation environment. Not for clinical use or production PHI.
          </p>
        </form>
      </motion.div>
    </div>
  );
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}
