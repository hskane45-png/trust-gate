# Deploy Trust Gate for $0

Beginner path to a public demo URL. No paid APIs. No credit card required on the recommended path (Render free tier, as of 2026 docs).

## 1. GitHub (free)

1. Create a free [GitHub](https://github.com) account if you do not have one.
2. Create a new **public or private** repository (empty is fine).
3. From this folder, push the code:

```bash
cd /workspace/trust-gate   # or wherever this project lives
git init                   # skip if already a repo
git add .
git commit -m "Trust Gate MVP + deploy scaffolding"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Use an existing repo if you already have one — just push this folder (or the repo root if Trust Gate *is* the repo).

## 2. Render.com free (no credit card)

1. Sign up at [https://render.com](https://render.com) with GitHub (Hobby / free). **No credit card** required for free web services per Render’s 2026 docs.
2. Dashboard → **New** → **Web Service**.
3. Connect the GitHub repo you pushed.
4. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm i && npm run build`
   - **Start Command:** `npm start`
   - **Instance type:** **Free**
5. Environment variables (Dashboard → Environment):

| Key | Value |
|-----|--------|
| `MOCK_MODE` | `1` |
| `ADMIN_TOKEN` | any long random string (not a real secret in git) |
| `PORT` | `8787` (Render also injects `PORT`; the app reads `process.env.PORT`) |

Optional: use the included `render.yaml` Blueprint (**New** → **Blueprint**) so env keys and free plan are prefilled — still set `ADMIN_TOKEN` in the dashboard (`sync: false`).

6. Click **Deploy**. Wait for the build. Open the `*.onrender.com` URL → try `GET /health`.

### Free-tier sleep

Free web services **spin down after ~15 minutes idle**. The next request cold-starts (~30–60s). That is fine for demos.

## 3. If Render asks for a card

Do **not** add a card for a $0 demo.

- Keep mock mode on **localhost only**:

  ```bash
  cd /workspace/trust-gate
  npm i
  MOCK_MODE=1 npm run dev
  ```

- **Do not** use Railway or Fly if they require a credit card for new accounts.
- Docker locally (optional, still $0):

  ```bash
  docker build -t trust-gate .
  docker run --rm -p 8787:8787 -e MOCK_MODE=1 -e ADMIN_TOKEN=dev-admin trust-gate
  ```

## 4. Smoke test after deploy

Replace `YOUR_PUBLIC_URL` with your Render URL (no trailing slash):

```bash
curl -s YOUR_PUBLIC_URL/health
curl -s -X POST YOUR_PUBLIC_URL/v1/check \
  -H 'content-type: application/json' \
  -d '{"url":"https://docs.base.org/","wallet":"0x742d35Cc6634C0532925a3b844Bc454e4438f44e","amount_usdc":0.5}'
```

With `MOCK_MODE=1`, `/v1/check` does not require x402 payment.

## 5. What not to do

- Do not commit `.env` or real `ADMIN_TOKEN` / private keys.
- Do not turn off `MOCK_MODE` on free tier unless you intentionally wire x402 (still no paid third-party keys in this MVP).
- Do not rely on free tier for production uptime — sleep + monthly free hours are demo-grade only.

See also [OUTREACH.md](./OUTREACH.md) for share-ready copy once you have a public URL.
