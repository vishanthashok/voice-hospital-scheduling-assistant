# Deploy MediVoice

**API:** [Render](https://render.com) (Python / FastAPI) — no Fly CLI, connect GitHub in the browser.  
**Web:** [Cloudflare Pages](https://pages.cloudflare.com/) — optional GitHub Action builds and uploads the SPA.

---

## 1. API on Render

1. Sign up at [render.com](https://render.com) (GitHub login is fine).
2. **New → Blueprint** → connect this repo → Render reads [`render.yaml`](render.yaml) and creates **medivoice-api**.  
   *Or:* **New → Web Service** → same repo → **Root Directory** `backend` → **Build** `pip install -r requirements.txt` → **Start** `uvicorn main:app --host 0.0.0.0 --port $PORT`.
3. In the service **Environment**, set (minimum):
   - `GEMINI_API_KEY`
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164)
   - `PUBLIC_BASE_URL` = your API’s public URL (e.g. `https://medivoice-api.onrender.com`) — **no trailing slash**
4. Wait until it’s **Live**, then open `https://<your-service>.onrender.com/health`.

**Custom domain (`api.medivoice.us`):** Render → your service → **Settings → Custom Domain** → add hostname → put the CNAME in DNS.

---

## 2. Web on Cloudflare Pages (CI)

The workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) deploys **`frontend/`** to Pages when you push to `main`.

**Repository secrets** (GitHub → **Settings → Secrets and variables → Actions**):

| Secret | Example |
|--------|--------|
| `VITE_API_BASE` | `https://medivoice-api.onrender.com` (same origin as API; no `/` at end) |
| `CLOUDFLARE_API_TOKEN` | API token with **Pages — Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | From Cloudflare dashboard |

Create the Pages project once: `npx wrangler pages project create medivoice-web` or in the Cloudflare UI (name must match the workflow: **medivoice-web**).

---

## 3. Twilio

Voice webhook: `POST https://<your-api-host>/voice/incoming`  
Or run `python scripts/set_twilio_webhook.py` with `PUBLIC_BASE_URL` in `.env`.

---

## 4. Optional: `backend/Dockerfile`

Useful if you deploy the API on **Cloud Run**, **Railway**, or another Docker host; Render can use native Python without it.

---

## Dropped: Fly.io

We removed Fly-specific config. If you still have a `flyctl` login, you can ignore it for this project.
