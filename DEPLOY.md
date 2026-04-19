# Deploy MediVoice — recommended setup

**Why not “Cloudflare only”?** Cloudflare Pages is ideal for the **static** React app. Your **API is Python (FastAPI)**; running it on Workers is the wrong tool. The usual pattern is **Cloudflare for the website + DNS/CDN**, and a **small Python host** for the API.

## Recommended (best balance for solo + `medivoice.us`)

| Piece | Service | Role |
|--------|---------|------|
| **Dashboard (static)** | [Cloudflare Pages](https://pages.cloudflare.com/) | Hosts `frontend/` build; global CDN + free TLS |
| **API (FastAPI)** | [Railway](https://railway.app/) or [Fly.io](https://fly.io/) | Runs `backend/`; public HTTPS URL; easy env vars |
| **DNS** | [Cloudflare DNS](https://developers.cloudflare.com/dns/) | Point `api.medivoice.us` → API host, `@` / `www` → Pages |

**Order of operations**

1. **Deploy the API** (Railway/Fly): root directory `backend`, start e.g. `uvicorn main:app --host 0.0.0.0 --port $PORT`, install from `requirements.txt`. Set `GEMINI_API_KEY`, Twilio vars, and **`PUBLIC_BASE_URL=https://api.medivoice.us`** (after DNS works) or your temporary `https://….railway.app` URL first.
2. **Add custom hostname** `api.medivoice.us` on that host; at your DNS provider create the **CNAME** they show.
3. **Cloudflare Pages**: connect GitHub repo, **Root directory** `frontend`, **Build command** `npm run build`, **Output** `dist`. **Environment variable** (build-time): **`VITE_API_BASE=https://api.medivoice.us`** (no trailing slash). Redeploy when the API URL is final.
4. **Pages custom domain**: `medivoice.us` / `www` as you prefer; follow the CNAME/TXT steps Cloudflare gives you.
5. **Twilio**: Voice webhook `POST https://api.medivoice.us/voice/incoming` (or run `scripts/set_twilio_webhook.py` with `PUBLIC_BASE_URL` set).

**GoDaddy + Cloudflare:** Either change **nameservers** at GoDaddy to Cloudflare (simplest for one dashboard), or leave DNS at GoDaddy and add **only** the records Pages/Railway tell you (more clicking, same result).

---

## Env checklist (production)

**API**

- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (E.164)
- `PUBLIC_BASE_URL` = public API origin, e.g. `https://api.medivoice.us`

**Frontend build (Pages / any static host)**

- `VITE_API_BASE` = same API origin as above

---

## Alternatives

- **All-in-one:** [Railway](https://railway.app) two services from one repo (static + API) — fewer vendors, slightly less edge caching than Pages.
- **GCP/AWS:** Cloud Run / App Runner — great if you already live there.
- **VPS + Caddy:** Maximum control; you maintain TLS and process supervision.

The repo stays **provider-neutral**; no vendor config files are required beyond each host’s UI.
