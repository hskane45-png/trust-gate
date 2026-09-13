# Redeploy Trust Gate (fix for `x-render-routing: no-server`)

## Root cause

Live URL returned HTTP 404 with `x-render-routing: no-server` — Render’s edge had **no healthy process listening**.

Likely contributors in the first Docker deploy:

1. **Dockerfile did not `COPY data/`** into the runner image. Sanctions loading already soft-fails, but production should ship `data/ofac-eth-addresses.json`.
2. **Key persistence** wrote `.data/keys.json` without a safe fallback. On a read-only or missing parent dir, `mkdirSync` / `writeFileSync` could throw and kill the process after boot (or on cold start).
3. **Hardcoded `PORT=8787` in `render.yaml`** could fight Render’s injected `PORT`. The app already uses `process.env.PORT`; Blueprint no longer sets `PORT`.

## What changed in this fix

| File | Change |
|------|--------|
| `Dockerfile` | `COPY data ./data` in build + runner; create `/app/.data`; run as `node` user |
| `src/receipt.ts` | Env/file key load never throws; FS write failures → ephemeral in-memory keys |
| `src/index.ts` | Boot wraps `getKeys()` so unexpected errors don’t abort listen |
| `render.yaml` | Removed hardcoded `PORT` |
| `.dockerignore` | Added (keeps image lean) |
| `DEPLOY.md` | Clarified Node vs Docker + Manual Deploy |

## Prefer: Node runtime on Render (simplest)

In Render → Web Service settings:

- **Runtime:** Node
- **Build Command:** `npm i && npm run build`
- **Start Command:** `npm start`
- **Health Check Path:** `/health`
- Env: `MOCK_MODE=1`, `ADMIN_TOKEN=<random>`, `HOST=0.0.0.0` — **do not set PORT**

## Docker runtime (also supported)

If the service uses Docker, the updated `Dockerfile` is enough. Render still injects `PORT`; the app binds to it.

## What you must do (GitHub Desktop → push → redeploy)

Code was fixed on the agent box. **Push cannot be done from the agent** — you push from your machine.

### Option A — Sync from tarball (fastest)

1. Unpack `/workspace/trust-gate-fix.tar.gz` over your local clone (or open the folder GitHub Desktop uses).
2. In **GitHub Desktop**: see changed files → **Commit** → **Push origin**.
3. On [Render Dashboard](https://dashboard.render.com) → your `trust-gate` service → **Manual Deploy** → **Deploy latest commit** (if auto-deploy does not fire).

### Option B — Pull then replace files

If Desktop already tracks `https://github.com/hskane45-png/trust-gate`:

1. Fetch/pull current `main`.
2. Copy in the updated files from the tarball (at least: `Dockerfile`, `src/receipt.ts`, `src/index.ts`, `render.yaml`, `.dockerignore`, `DEPLOY.md`, `REDEPLOY.md`).
3. Commit + push → Manual Deploy on Render.

### Smoke test

After deploy (cold start on free tier can take 30–60s):

```bash
curl -sI https://trust-gate-hgb7.onrender.com/health
curl -s https://trust-gate-hgb7.onrender.com/health
```

Expect `200` and JSON `{ "ok": true, ... }`. Header `x-render-routing: no-server` should be gone.

If still `no-server`: open Render → **Logs**. You should see `Trust Gate listening on http://0.0.0.0:<PORT>` and `Sanctions loaded: …`. If the process exits immediately, paste those lines.
