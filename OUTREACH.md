# Outreach drafts (Trust Gate)

Replace `YOUR_PUBLIC_URL` with your public demo URL (e.g. `https://trust-gate.onrender.com`) before posting.

---

## Short X / Twitter post (< 280 chars)

```
Shipping Trust Gate — a pre-spend screen for AI agents on Base (USDC / x402).

Screens destination wallet + URL under policy before the agent pays. MOCK mode free to try:

YOUR_PUBLIC_URL

#Base #x402 #AIAgents
```

---

## Longer Discord / forum post

**Title:** Trust Gate — pre-spend screen for agent USDC payments (open demo)

Hey — sharing a small MVP: **Trust Gate**, a pre-spend check for AI agents paying USDC via x402 on Base.

Agents call `POST /v1/check` with a destination wallet and/or URL. Policy returns ALLOW / WARN / BLOCK plus a signed receipt (Ed25519 / JWKS). The wedge is screening the **destination** (payee + URL), not only caller reputation or OFAC lists.

Zero-cost demo path: `MOCK_MODE=1` (no live facilitator, no paid APIs). Free tier deploy sleeps after idle — cold start is OK for trying it.

- Health: `GET YOUR_PUBLIC_URL/health`
- Check (mock): `POST YOUR_PUBLIC_URL/v1/check` with JSON `{ "url", "wallet", "amount_usdc" }`
- Docs / deploy: see `DEPLOY.md` in the repo

Feedback from agent builders welcome — especially policy defaults and what signals you’d want next.

---

## 5-line DM template (agent builders)

```
Hey — built Trust Gate: pre-spend screen for agents paying USDC (x402 / Base). Checks destination wallet + URL under policy before spend. Live mock demo: YOUR_PUBLIC_URL — try POST /v1/check. Would love 2 min feedback if you’re wiring agent payments.
```

---

## Checklist before you send

- [ ] `YOUR_PUBLIC_URL` replaced everywhere
- [ ] `GET /health` returns `ok: true` (wake free tier first if asleep)
- [ ] You are comfortable with cold starts on free Render
