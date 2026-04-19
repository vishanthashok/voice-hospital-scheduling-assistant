# Deploy MediVoice (provider-neutral)

You need **two HTTPS endpoints**:

1. **API** — FastAPI in `backend/` (Twilio webhooks, `/triage`, `/health`, `/voice/*`, SSE).
2. **Web UI** — static build from `frontend/` (`npm run build` → `frontend/dist`).

Build the SPA with **`VITE_API_BASE`** set to your **API origin** (no trailing slash), e.g. `https://api.medivoice.us`.

On the API host, set at minimum **`GEMINI_API_KEY`**, Twilio vars, and **`PUBLIC_BASE_URL`** to that same API origin so Twilio `Gather` URLs are absolute.

**Examples** (pick one): [Railway](https://railway.app), [Fly.io](https://fly.io), [Google Cloud Run](https://cloud.google.com/run), [AWS App Runner / ECS](https://aws.amazon.com/apprunner/), a **VPS** with **Caddy** or **nginx** + **certbot**, or **Cloudflare** (Tunnel + Pages). The repo does not assume a single vendor.

**Custom domain (e.g. medivoice.us):** point **`api.*`** at the API and **`@` / `www`** at the static host; issue TLS at the edge or on the server; then set `PUBLIC_BASE_URL` and `VITE_API_BASE` to `https://api.yourdomain.tld` and rebuild the frontend.

**Twilio:** `POST https://<API>/voice/incoming` or use `scripts/set_twilio_webhook.py` with `PUBLIC_BASE_URL` in `.env`.
