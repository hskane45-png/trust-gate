/**
 * Business policies + usage metering (in-memory).
 * POST /v1/business/policies — ADMIN_TOKEN
 * GET /v1/business/usage — API key
 */

import { Hono } from "hono";
import { findPolicyByApiKey, upsertPolicy, listPolicies, getPolicy } from "./policy.js";
import { randomBytes } from "node:crypto";

type UsageEntry = { checks: number; last_at: string | null };

const usageByApiKey = new Map<string, UsageEntry>();
const usageByPolicy = new Map<string, UsageEntry>();

export function recordUsage(policyId: string, apiKey?: string): void {
  const now = new Date().toISOString();
  const p = usageByPolicy.get(policyId) ?? { checks: 0, last_at: null };
  p.checks += 1;
  p.last_at = now;
  usageByPolicy.set(policyId, p);

  if (apiKey) {
    const u = usageByApiKey.get(apiKey) ?? { checks: 0, last_at: null };
    u.checks += 1;
    u.last_at = now;
    usageByApiKey.set(apiKey, u);
  }
}

export function getUsageForApiKey(apiKey: string) {
  const policy = findPolicyByApiKey(apiKey);
  const u = usageByApiKey.get(apiKey) ?? { checks: 0, last_at: null };
  return {
    api_key_prefix: apiKey.slice(0, 8) + "…",
    policy_id: policy?.id ?? null,
    checks: u.checks,
    last_at: u.last_at,
  };
}

function requireAdmin(authHeader: string | undefined): boolean {
  const token = process.env.ADMIN_TOKEN || "dev-admin-token-change-me";
  if (!authHeader) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const raw = m ? m[1] : authHeader;
  return raw === token;
}

export function businessRoutes(): Hono {
  const app = new Hono();

  app.post("/policies", async (c) => {
    if (!requireAdmin(c.req.header("Authorization") || c.req.header("X-Admin-Token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = await c.req.json<{
      id?: string;
      name: string;
      deny_hosts?: string[];
      allow_hosts?: string[];
      allow_domains?: string[];
      deny_domains?: string[];
      sanctions_action?: "block" | "warn" | "allow";
      suspicious_url_action?: "block" | "warn";
      block_on_warn?: boolean;
      max_amount_usdc?: number;
      daily_cap_usdc?: number;
      mint_api_key?: boolean;
    }>();

    if (!body?.name) {
      return c.json({ error: "name required" }, 400);
    }

    const api_key = body.mint_api_key ? `tg_${randomBytes(24).toString("hex")}` : undefined;
    const policy = upsertPolicy({ ...body, api_key });
    return c.json({
      policy: {
        id: policy.id,
        name: policy.name,
        deny_hosts: policy.deny_hosts,
        allow_hosts: policy.allow_hosts,
        sanctions_action: policy.sanctions_action,
        suspicious_url_action: policy.suspicious_url_action,
        block_on_warn: policy.block_on_warn,
        max_amount_usdc: policy.max_amount_usdc,
        daily_cap_usdc: policy.daily_cap_usdc,
        created_at: policy.created_at,
      },
      api_key: api_key ?? undefined,
      note: api_key ? "Store api_key securely; shown once" : undefined,
    });
  });

  app.get("/policies", async (c) => {
    if (!requireAdmin(c.req.header("Authorization") || c.req.header("X-Admin-Token"))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return c.json({ policies: listPolicies() });
  });

  app.get("/usage", async (c) => {
    const apiKey =
      c.req.header("X-API-Key") ||
      c.req.header("x-api-key") ||
      (() => {
        const a = c.req.header("Authorization");
        const m = a?.match(/^Bearer\s+(tg_.+)$/i);
        return m?.[1];
      })();

    if (!apiKey) {
      return c.json({ error: "API key required (X-API-Key)" }, 401);
    }
    const policy = findPolicyByApiKey(apiKey);
    if (!policy) {
      return c.json({ error: "unknown api key" }, 401);
    }
    return c.json(getUsageForApiKey(apiKey));
  });

  return app;
}

export function extractApiKey(c: { req: { header: (n: string) => string | undefined } }): string | undefined {
  return (
    c.req.header("X-API-Key") ||
    c.req.header("x-api-key") ||
    undefined
  );
}

export function resolvePolicyIdFromRequest(
  bodyPolicyId: string | undefined,
  apiKey: string | undefined
): string | undefined {
  if (bodyPolicyId) return bodyPolicyId;
  if (apiKey) {
    const p = findPolicyByApiKey(apiKey);
    return p?.id;
  }
  return undefined;
}

export { getPolicy };
