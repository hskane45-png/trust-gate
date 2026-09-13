# Trust Gate — one-pager

## Problem
AI agents are starting to spend USDC on-chain (x402 and similar). One wrong payee URL or wallet and funds are gone. Existing tools either check caller reputation or dump an OFAC list — they do not screen the **destination** of a spend under a business policy.

## What Trust Gate does
A pre-spend screen: given a destination **URL + payee wallet + amount**, return **ALLOW / WARN / BLOCK** plus an Ed25519-signed receipt. Offline URL heuristics, offline OFAC/ETH address match, and business policies (allow/deny domains, amount caps, block-on-warn).

## Curl example (MOCK_MODE=1)

```bash
curl -s http://localhost:8787/v1/check \
  -H 'content-type: application/json' \
  -d '{"url":"https://docs.base.org/","wallet":"0x742d35Cc6634C0532925a3b844Bc454e4438f44e","amount_usdc":0.5,"policy_id":"demo-business"}'
```

## Pricing (documented — no Stripe in MVP)
- **Agent:** 0.02 USDC per check via x402
- **Business Starter:** $49/mo — 10k checks
- **Business Growth:** $199/mo — 100k checks
- **Overage:** $0.01 per check

Mock endpoint live at `<URL TBD>`

## Wedge vs adjacent
- **vs ClearAgent:** ClearAgent focuses on agent/caller trust; Trust Gate screens the **destination** (payee + URL) before spend.
- **vs oceanrun:** oceanrun is execution/runtime oriented; Trust Gate is the policy gate that answers “should this payee/URL get paid?” before funds move.
