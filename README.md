# MediVoice

### Your ER triage nurse, on the other end of the phone.

Patients call a number. Gemini listens. A risk score hits the nurse's
dashboard before the caller finishes their sentence.

---

## The problem

When an ER is slammed, the triage nurse spends 60–90 seconds per call
just *listening* before they can act. Multiply that across 200 calls a
shift and you've buried critical patients under the routine ones.

**Chest pain at minute 3 looks identical to a sore throat at minute 3
until someone finishes the sentence.** We wanted a second set of ears
that never gets tired.

## What we built

A voice-first triage dashboard that does three things the moment the
phone rings:

1. **Listens.** Twilio streams the caller's speech into our FastAPI.
2. **Reasons.** Gemini 2.5 Flash, prompted as a "Board-Certified Triage
   Nurse," turns the transcript into a strict JSON verdict: a 0–100
   risk score, a P1/P2/P3 priority, a one-line rationale, and the three
   strongest clinical drivers.
3. **Ranks.** Every card in the nurse's queue re-sorts by risk, in
   real time, while the caller is still on the line.

When the call ends, the nurse can download a FHIR `RiskAssessment`
bundle and hand it to the EHR. No copy-paste. No lag.

## See it

```
┌─ MediVoice — Status board ─────────────────────────────┐
│                                                        │
│   LIVE CALL IN PROGRESS   "I have chest tightness..."  │
│                                                        │
│   Jordan Ellis        87/100   P1 · CRITICAL   ████▌   │
│   Taylor Chen         54/100   P2 · ELEVATED   ██▌     │
│   Riley Park          31/100   P3 · ROUTINE    █▌      │
│   Sam Rivera          22/100   P3 · ROUTINE    █       │
│   Morgan Blake        18/100   P3 · ROUTINE    ▌       │
│                                                        │
│   ▼ Top clinical drivers ──────────────────────────    │
│     1 Chest Pain    2 Exertional Dyspnea    3 Age>65   │
│                                                        │
│   [Download FHIR]  [Mark resolved]                     │
└────────────────────────────────────────────────────────┘
```

The whole dashboard lives at `http://localhost:3000` and updates via
Server-Sent Events, so there's zero poll lag.

## How it works

```
      Caller                                Nurse's laptop
        │                                          │
        │ 📞                                       │
        ▼                                          ▲
    Twilio Voice                                   │ SSE
        │                                          │
        │ webhook                                  │
        ▼                                          │
    FastAPI  ──── "triage this transcript" ───►  Gemini 2.5
    /voice/gather                                  │
        │         ◄──── risk_score, priority, ────┘
        │              rationale, top_drivers
        ▼
    audit log + FHIR export
```

Four files, four responsibilities:

| File | Does |
| --- | --- |
| `backend/main.py` | FastAPI. Twilio webhooks, Gemini calls, SSE. |
| `frontend/src/App.jsx` | React dashboard. Status board + clinical workspace. |
| `frontend/src/components/LiveCallVisualizer.jsx` | Subscribes to SSE, animates the live call. |
| `scripts/set_twilio_webhook.py` | One-shot: points your Twilio number at your backend. |

## Tech stack

**AI** — Google Gemini 2.5 Flash (triage reasoning)
**Voice** — Twilio Voice API (inbound call + speech capture)
**Backend** — FastAPI, Python 3.14, Server-Sent Events
**Frontend** — React 18, Vite, Tailwind, Framer Motion, Lucide
**Interop** — FHIR `RiskAssessment` resource
**Tunneling** — Cloudflare Quick Tunnel (no signup, zero config)

## Quick start

You need a Gemini API key, a Twilio trial number, and three minutes.

```bash
# 1. Backend
cd backend
pip install -r requirements.txt
# put GEMINI_API_KEY, TWILIO_*, and PUBLIC_BASE_URL in ../.env
python -m uvicorn main:app --reload --port 8000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev        # → http://localhost:3000

# 3. Make your number reachable (separate terminal)
cloudflared tunnel --url http://localhost:8000
# copy the https URL, paste into PUBLIC_BASE_URL, then:
python scripts/set_twilio_webhook.py
```

**That's it.** Call your Twilio number and the dashboard lights up.

Full environment setup and the full endpoint map are in
[`.env.example`](.env.example) and the source — we tried hard to keep
this repo runnable-at-a-glance.

## The 5am debugging lessons

Things that bit us, preserved in the README so they don't bite you:

- **`GEMINI_API_KEY` length 20 instead of 39.** A stale Windows
  user-level env var was overriding `.env`. Fix: `load_dotenv(override=True)`
  in `backend/main.py`, plus one PowerShell line to nuke the stale var.
- **`limit: 0` on `gemini-2.0-flash`.** Free-tier quota is per-model;
  `gemini-2.5-flash` worked instantly.
- **Twilio `<Gather action="/voice/gather">` (relative).** Twilio's
  cloud can't resolve relatives — the action must be absolute. We now
  build it from `PUBLIC_BASE_URL` at request time.
- **Two uvicorns on :8000.** Killing the shell that launched uvicorn
  doesn't kill the reloader parent. `Get-Process python | Stop-Process`.

## What's next

- **Real-time STT with Twilio Media Streams** (today we use
  `<Gather input="speech">`, which buffers until the caller stops — we
  can score *mid-sentence* with a streaming provider).
- **Click-to-call from the dashboard** for callbacks. Scaffolded but
  gated behind Twilio verified caller IDs on trial accounts.
- **Better prompts** — calibrating the risk cutoffs against real
  historical triage outcomes.
- **Deploy.** Render + named Cloudflare Tunnel gives a stable URL.

## Under the hood (optional reading)

The repo also contains an earlier scheduling pipeline (`app/`,
`ml-backend/`, `server.ts`) — voice → intent → calendar booking with
Fish Audio + OpenAI. It works, it's not the focus of this submission,
and it shares the `.env` file with the triage demo.

## Built by

One weekend, too much coffee, a Twilio trial credit.
Not a medical device. Don't use this to actually triage real patients.

## License

MIT — educational / demo use.
