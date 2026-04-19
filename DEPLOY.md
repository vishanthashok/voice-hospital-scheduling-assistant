# Deploy MediVoice

**Why split hosting?** Cloudflare Pages is ideal for the **static** React app. The **API is Python (FastAPI)** — use a small container host (this repo targets **Fly.io** + **Cloudflare Pages**).

---

## Automated deploy (GitHub Actions)

The workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every push to `main`. **Deployment still requires your accounts** — add secrets and complete one-time setup below.

### One-time: Fly.io (API)

1. Install [`flyctl`](https://fly.io/docs/hands-on/install-flyctl/), then `fly auth login`.
2. Create the app name used in [`backend/fly.toml`](backend/fly.toml) (default **`medivoice-api`**), or change `app = "..."` in that file:
   ```bash
   flyctl apps create medivoice-api
   ```
3. Set production secrets on Fly:
   ```bash
   cd backend
   flyctl secrets set GEMINI_API_KEY="..." TWILIO_ACCOUNT_SID="..." TWILIO_AUTH_TOKEN="..." TWILIO_PHONE_NUMBER="+1..." PUBLIC_BASE_URL="https://medivoice-api.fly.dev"
   ```
   Use your real **`PUBLIC_BASE_URL`** (Fly’s URL or `https://api.medivoice.us` after DNS).

4. Create a deploy token for CI:
   ```bash
   flyctl tokens create deploy
   ```
   Add it as repository secret **`FLY_API_TOKEN`**.

### One-time: Cloudflare Pages (web)

1. Create a Pages project **`medivoice-web`** (or change the name in the workflow file).
   - CLI: `npx wrangler pages project create medivoice-web`
2. Create an **API token** with **Cloudflare Pages — Edit** (and **Account** read if needed). Add **`CLOUDFLARE_API_TOKEN`**.
3. Copy **Account ID** from the Cloudflare dashboard → **`CLOUDFLARE_ACCOUNT_ID`**.
4. Add **`VITE_API_BASE`** = your **API public HTTPS origin**, no trailing slash (e.g. `https://medivoice-api.fly.dev` or `https://api.medivoice.us`).

### GitHub repository secrets

| Secret | Purpose |
|--------|---------|
| `FLY_API_TOKEN` | `flyctl deploy` from CI |
| `CLOUDFLARE_API_TOKEN` | Wrangler Pages deploy |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account |
| `VITE_API_BASE` | Baked into the SPA at build time (must match API) |

Push to `main` after these are set. **Actions** → **Deploy** → **Run workflow** also works manually.

### Custom domain (`medivoice.us`)

- **API:** Fly → **certificates** → add `api.medivoice.us` → CNAME at DNS.
- **Web:** Pages → **medivoice-web** → **Custom domains** → `medivoice.us` / `www`.
- Update **`PUBLIC_BASE_URL`** on Fly and **`VITE_API_BASE`** in GitHub secrets, then push or re-run the workflow.

---

## Manual / other hosts

Build `frontend/` with `VITE_API_BASE` set; run `backend/` with Uvicorn or Docker ([`backend/Dockerfile`](backend/Dockerfile)). [Railway](https://railway.app), [Cloud Run](https://cloud.google.com/run), etc. are fine.

**Twilio:** `POST https://<your-api>/voice/incoming` or `python scripts/set_twilio_webhook.py` with `PUBLIC_BASE_URL` in `.env`.
