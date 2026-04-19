# Deploy MediVoice (recommended: Render + medivoice.us)

## 1. Render (one provider for API + static UI)

1. Create a [Render](https://render.com) account and connect this GitHub repo.
2. **New → Blueprint** → select the repo. Render reads `render.yaml` and creates:
   - **medivoice-api** — Python / FastAPI (`backend/`)
   - **medivoice-web** — static site (`frontend/`), with `VITE_API_BASE` wired to the API URL.

3. In the Render dashboard, open **medivoice-api → Environment** and set (minimum):

   - `GEMINI_API_KEY`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164, e.g. `+1…`)

   Optional: `GEMINI_MODEL` (e.g. `gemini-2.5-flash`).

4. Wait until both services are **live**. Check `https://<medivoice-api-host>/health`.

`PUBLIC_BASE_URL` is optional on first deploy: the API uses `RENDER_EXTERNAL_URL` automatically so Twilio TwiML gets absolute URLs. After you attach a **custom API domain** (below), set `PUBLIC_BASE_URL` to that URL.

## 2. Custom domain on medivoice.us (GoDaddy DNS)

Suggested mapping:

| Hostname | Points to |
|----------|-----------|
| `api.medivoice.us` | **medivoice-api** (Render custom domain wizard gives a CNAME target) |
| `medivoice.us` or `www.medivoice.us` | **medivoice-web** (same: follow Render’s CNAME instructions) |

In Render: each service → **Settings → Custom Domain** → add the name → add the records GoDaddy shows until verified and HTTPS works.

Then:

1. **medivoice-api** env: `PUBLIC_BASE_URL=https://api.medivoice.us` (no trailing slash). Redeploy if needed.
2. **medivoice-web** env: `VITE_API_BASE=https://api.medivoice.us` → **Manual Deploy** so the bundle rebuilds.

3. Twilio: Voice webhook `POST https://api.medivoice.us/voice/incoming`, or run `python scripts/set_twilio_webhook.py` locally with `PUBLIC_BASE_URL=https://api.medivoice.us` in `.env`.

## 3. Legacy stack

The older Node + `server.ts` scheduling app is described in `render.legacy-scheduling.yaml` (not used by the MediVoice triage dashboard).
