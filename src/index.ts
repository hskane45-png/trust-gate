/**
 * Trust Gate — Hono server
 * Pre-spend screen for AI agents (USDC / x402 on Base).
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { runCheck, type CheckInput } from "./check.js";
import { jwks, getReceipt, getKeys, verifyReceipt } from "./receipt.js";
import { x402Middleware, isMockMode } from "./x402.js";
import {
  businessRoutes,
  extractApiKey,
  recordUsage,
  resolvePolicyIdFromRequest,
} from "./business.js";
import { initPolicies } from "./policy.js";
import { loadSanctionsList } from "./signals/wallet.js";

initPolicies();
const sanctionsMeta = loadSanctionsList();
console.log(`Sanctions loaded: ${sanctionsMeta.count} addresses (${sanctionsMeta.source})`);
// Ensure keys exist at boot
getKeys();

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "trust-gate",
    mock_mode: isMockMode(),
    ts: new Date().toISOString(),
  })
);

app.get("/", (c) => {
  const accept = c.req.header("Accept") || "";
  const blurb = {
    name: "Trust Gate",
    tagline: "Pre-spend screen for AI agents — destination wallet + URL under policy",
    wedge: "Screen DESTINATION (payee + URL), not OFAC-only, not caller reputation-only",
    endpoints: {
      "GET /health": "free",
      "GET /v1/jwks.json": "free",
      "GET /v1/receipts/:id": "free",
      "POST /v1/check": "paid via x402 ($0.02 USDC) or MOCK_MODE=1",
      "POST /v1/business/policies": "ADMIN_TOKEN",
      "GET /v1/business/usage": "API key",
    },
    pricing: {
      agent: "$0.02 USDC / check via x402",
      business: {
        starter: "$49/mo — 10k checks",
        growth: "$199/mo — 100k checks",
        overage: "$0.01 / check",
        note: "Documented only — no Stripe in MVP",
      },
    },
    mock_mode: isMockMode(),
  };

  if (accept.includes("text/html")) {
    return c.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><title>Trust Gate</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f5;padding:.1em .3em;border-radius:4px}</style></head>
<body>
<h1>Trust Gate</h1>
<p>Pre-spend screen for AI agents (USDC / x402 on Base). Screens <strong>destination</strong> payee wallet + URL under policy.</p>
<ul>
<li>Agent: <code>$0.02 USDC / check</code> via x402</li>
<li>Business: <code>$49/mo</code> Starter 10k · <code>$199/mo</code> Growth 100k · overage <code>$0.01</code></li>
</ul>
<p>Try <code>GET /health</code> · <code>POST /v1/check</code> (MOCK_MODE=${isMockMode() ? "on" : "off"})</p>
<pre>${JSON.stringify(blurb, null, 2)}</pre>
</body></html>`);
  }
  return c.json(blurb);
});

app.get("/v1/jwks.json", (c) => c.json(jwks()));

app.get("/v1/receipts/:id", (c) => {
  const id = c.req.param("id");
  const r = getReceipt(id);
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json({ receipt: r, verified: verifyReceipt(r) });
});

app.route("/v1/business", businessRoutes());

app.post("/v1/check", x402Middleware, async (c) => {
  let body: CheckInput;
  try {
    body = await c.req.json<CheckInput>();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!body.wallet && !body.url && !body.payee) {
    return c.json({ error: "At least one of wallet or url required (payee counts as wallet)" }, 400);
  }

  const apiKey = extractApiKey(c);
  const policyId = resolvePolicyIdFromRequest(body.policy_id, apiKey);
  try {
    const result = runCheck({ ...body, policy_id: policyId });
    if (apiKey || policyId) {
      recordUsage(policyId || "default", apiKey);
    } else {
      recordUsage("default");
    }
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "check failed" }, 400);
  }
});

const port = Number(process.env.PORT || 8787);
const hostname = process.env.HOST || "0.0.0.0";

console.log(
  `Trust Gate listening on http://${hostname}:${port} (MOCK_MODE=${isMockMode() ? "1" : "0"})`
);

serve({ fetch: app.fetch, port, hostname });

export default app;
