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

## 2. API on AWS (optional — if you already use AWS)

Same environment variables as Render: `GEMINI_API_KEY`, `GEMINI_MODEL` (optional), Twilio vars, **`PUBLIC_BASE_URL`** = the **public HTTPS URL of this API** (no trailing slash).

### Option A — **AWS App Runner** (simplest AWS path for this app)

The repo includes [`backend/Dockerfile`](backend/Dockerfile).

1. **ECR:** Create a repository (e.g. `medivoice-api`), then build and push the image from the `backend/` directory (Docker must target that folder as context).
2. **App Runner:** Create a service **from the ECR image**. Set port to match the container (**8080** in the Dockerfile). Add the same env vars as above.
3. **`PUBLIC_BASE_URL`:** Use the App Runner default URL (e.g. `https://xxxxxxxx.us-east-1.awsapprunner.com`) until you attach a custom domain, then set it to e.g. `https://api.medivoice.us`.
4. **Custom domain:** App Runner → **Custom domains** → add `api.medivoice.us` → create the **CNAME** / validation records in **Route 53** (or GoDaddy).

### Option B — **ECS Fargate + ALB**

Run the same Docker image behind an Application Load Balancer. More moving parts (VPC, target groups, health checks on `/health`). Use this if your org already standardizes on ECS.

### Frontend on AWS

- **Amplify Hosting:** Connect the GitHub repo, set app root to **`frontend`**, build `npm run build`, artifact directory **`dist`**, and add **`VITE_API_BASE`** = your API URL at build time.  
- **S3 + CloudFront:** Upload `frontend/dist` to a bucket, serve via CloudFront; set `VITE_API_BASE` **before** `npm run build` locally or in CI.

You can still use **Cloudflare Pages** for the UI while the API lives on AWS — just point **`VITE_API_BASE`** at your App Runner (or ALB) URL.

---

## 3. Web on Cloudflare Pages (CI)

The workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) deploys **`frontend/`** to Pages when you push to `main`.

**Repository secrets** (GitHub → **Settings → Secrets and variables → Actions**):

| Secret | Example |
|--------|--------|
| `VITE_API_BASE` | `https://medivoice-api.onrender.com` (same origin as API; no `/` at end) |
| `CLOUDFLARE_API_TOKEN` | API token with **Pages — Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | From Cloudflare dashboard |

Create the Pages project once: `npx wrangler pages project create medivoice-web` or in the Cloudflare UI (name must match the workflow: **medivoice-web**).

---

## 4. Twilio

Voice webhook: `POST https://<your-api-host>/voice/incoming`  
Or run `python scripts/set_twilio_webhook.py` with `PUBLIC_BASE_URL` in `.env`.

---

## 5. Optional: `backend/Dockerfile`

Useful if you deploy the API on **Cloud Run**, **Railway**, or another Docker host; Render can use native Python without it.

---

## 6. Dropped: Fly.io

We removed Fly-specific config. If you still have a `flyctl` login, you can ignore it for this project.
