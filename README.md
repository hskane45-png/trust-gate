# Trust Gate

Pre-spend screen for AI agents (USDC / x402 on Base).
Screens destination payee wallet + URL under policy.

## Zero-cost path

No paid APIs. MOCK_MODE=1 is the default.

    cd /workspace/trust-gate
    npm i
    npm test
    MOCK_MODE=1 npm run dev

Public $0 demo: see **[DEPLOY.md](./DEPLOY.md)** (Render free tier; no card). Share copy: **[OUTREACH.md](./OUTREACH.md)**.

Local prod-shaped run: `npm run build` then `npm start`. Docker: see `Dockerfile`. Prefer Render free; do not use Railway/Fly if they require a card. Node MVP; Workers optional.

## Pricing (docs only, no Stripe)
- Agent: 0.02 USDC per check via x402
- Business Starter: 49/mo for 10k checks
- Business Growth: 199/mo for 100k checks
- Overage: 0.01 per check

## Endpoints

- GET /health, GET /, GET /v1/jwks.json, GET /v1/receipts/:id — free
- POST /v1/check — x402 or MOCK_MODE=1
- POST /v1/business/policies — ADMIN_TOKEN
- GET /v1/business/usage — X-API-Key

## Default policy

BLOCK deny-listed domains; WARN suspicious URL; BLOCK sanctions hits; else ALLOW.

## x402 (MOCK_MODE=0)

HTTP 402 exact scheme: network eip155:8453 or 84532, asset USDC, amount 20000, payTo from env. No live facilitator.

## Sample POST /v1/check bodies

ALLOW: {"url":"https://docs.base.org/","wallet":"0x742d35Cc6634C0532925a3b844Bc454e4438f44e","amount_usdc":0.5}

BLOCK: {"url":"https://phishing.example/drain","amount_usdc":2}

WARN: {"url":"http://random-site.example/checkout","amount_usdc":10}

Verify: GET /v1/jwks.json and GET /v1/receipts/:id (verified true).

## Receipts

Ed25519. Keys in .data/keys.json or RECEIPT_PRIVATE_KEY. JWKS at /v1/jwks.json.

## Stack

TypeScript, Hono, Node 20, vitest, tweetnacl

## Non-goals

No healthcare/clinic code. No custodial escrow. No paid third-party keys.

## Sample policy: `demo-business`

Seeded on boot:

- `allow_hosts`: `docs.base.org`, `*.coinbase.com`, `base.org` (wildcard supported)
- `deny_hosts`: includes `phishing.example`
- `max_amount_usdc`: 100
- `daily_cap_usdc`: 500
- `block_on_warn`: true

ALLOW under demo-business:

    curl -s http://localhost:8787/v1/check \
      -H 'content-type: application/json' \
      -d '{"url":"https://docs.base.org/","wallet":"0x742d35Cc6634C0532925a3b844Bc454e4438f44e","amount_usdc":0.5,"policy_id":"demo-business"}'

## Creating policies with ADMIN_TOKEN

    # ADMIN_TOKEN defaults to dev-admin-token-change-me (see .env.example)
    curl -s http://localhost:8787/v1/business/policies \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H 'content-type: application/json' \
      -d '{"id":"acme","name":"Acme Corp","allow_hosts":["docs.base.org","*.coinbase.com"],"deny_hosts":["phishing.example"],"max_amount_usdc":100,"daily_cap_usdc":500,"block_on_warn":true,"mint_api_key":true}'

Then call /v1/check with X-API-Key: tg_… or "policy_id":"acme".

List policies: GET /v1/business/policies with the same Bearer token.

## Sanctions / OFAC (offline)

- Bundled file: data/ofac-eth-addresses.json (community OFAC ETH addresses)
- Source + fetch date: see data/SOURCE.md (fetched 2026-09-08)
- Upstream: https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
- Loaded at boot by src/signals/wallet.ts; exact match is BLOCK (case-insensitive)
- Also includes a small demo stub (0x…dead style) for local demos
- Production must refresh this file from OFAC / a maintained feed. No paid API keys required for MVP.

See also: ONEPAGER.md
