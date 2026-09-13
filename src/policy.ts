/**
 * Default + Business policies (in-memory Map + optional JSON file store).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_ALLOW_HOSTS, DEFAULT_DENY_HOSTS } from "./signals/url.js";

export type Policy = {
  id: string;
  name: string;
  deny_hosts: string[];
  allow_hosts: string[];
  /** block | warn | allow — how to treat sanctions hits (default block) */
  sanctions_action: "block" | "warn" | "allow";
  /** block | warn — default for suspicious URL when not deny-listed */
  suspicious_url_action: "block" | "warn";
  /** Escalate any WARN verdict to BLOCK */
  block_on_warn: boolean;
  /** Per-check max amount in USDC (undefined = no limit) */
  max_amount_usdc?: number;
  /** Rolling calendar-day cap in USDC for this policy (undefined = no limit) */
  daily_cap_usdc?: number;
  created_at: string;
  api_key?: string;
};

export const DEFAULT_POLICY_ID = "default";
export const DEMO_BUSINESS_POLICY_ID = "demo-business";

const policies = new Map<string, Policy>();

/** Per-policy daily USDC totals: policyId -> { day: YYYY-MM-DD, spent: number } */
const dailySpend = new Map<string, { day: string; spent: number }>();

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordDailySpend(policyId: string, amountUsdc: number): void {
  if (!amountUsdc || amountUsdc <= 0) return;
  const day = utcDay();
  const cur = dailySpend.get(policyId);
  if (!cur || cur.day !== day) {
    dailySpend.set(policyId, { day, spent: amountUsdc });
  } else {
    cur.spent += amountUsdc;
  }
}

export function getDailySpend(policyId: string): number {
  const cur = dailySpend.get(policyId);
  if (!cur || cur.day !== utcDay()) return 0;
  return cur.spent;
}

/** Reset daily spend (tests). */
export function resetDailySpend(): void {
  dailySpend.clear();
}

function defaultPolicy(): Policy {
  return {
    id: DEFAULT_POLICY_ID,
    name: "Default",
    deny_hosts: [...DEFAULT_DENY_HOSTS],
    allow_hosts: [...DEFAULT_ALLOW_HOSTS],
    sanctions_action: "block",
    suspicious_url_action: "warn",
    block_on_warn: false,
    created_at: new Date().toISOString(),
  };
}

function demoBusinessPolicy(): Policy {
  return {
    id: DEMO_BUSINESS_POLICY_ID,
    name: "Demo Business",
    deny_hosts: [
      "phishing.example",
      "evil.example",
      "drain-wallet.example",
      "free-mint.rug",
    ],
    allow_hosts: ["docs.base.org", "*.coinbase.com", "base.org"],
    sanctions_action: "block",
    suspicious_url_action: "block",
    block_on_warn: true,
    max_amount_usdc: 100,
    daily_cap_usdc: 500,
    created_at: new Date().toISOString(),
  };
}

function storePath(): string | undefined {
  return process.env.POLICY_STORE_PATH;
}

function persist(): void {
  const path = storePath();
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const obj = Object.fromEntries(policies.entries());
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function normalizePolicy(p: Partial<Policy> & { id: string; name: string }): Policy {
  return {
    id: p.id,
    name: p.name,
    deny_hosts: p.deny_hosts ?? [...DEFAULT_DENY_HOSTS],
    allow_hosts: p.allow_hosts ?? [...DEFAULT_ALLOW_HOSTS],
    sanctions_action: p.sanctions_action ?? "block",
    suspicious_url_action: p.suspicious_url_action ?? "warn",
    block_on_warn: p.block_on_warn ?? false,
    max_amount_usdc: p.max_amount_usdc,
    daily_cap_usdc: p.daily_cap_usdc,
    created_at: p.created_at ?? new Date().toISOString(),
    api_key: p.api_key,
  };
}

function loadFromDisk(): void {
  const path = storePath();
  if (!path || !existsSync(path)) return;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, Policy>;
    for (const [id, p] of Object.entries(raw)) {
      policies.set(id, normalizePolicy({ ...p, id: p.id || id }));
    }
  } catch {
    // ignore corrupt store; defaults still apply
  }
}

function ensureDemoBusiness(): void {
  if (!policies.has(DEMO_BUSINESS_POLICY_ID)) {
    policies.set(DEMO_BUSINESS_POLICY_ID, demoBusinessPolicy());
  }
}

export function initPolicies(): void {
  policies.clear();
  policies.set(DEFAULT_POLICY_ID, defaultPolicy());
  loadFromDisk();
  if (!policies.has(DEFAULT_POLICY_ID)) {
    policies.set(DEFAULT_POLICY_ID, defaultPolicy());
  }
  ensureDemoBusiness();
}

export function getPolicy(id?: string): Policy {
  if (!policies.size) initPolicies();
  const pid = id || DEFAULT_POLICY_ID;
  return policies.get(pid) ?? policies.get(DEFAULT_POLICY_ID)!;
}

export function upsertPolicy(input: {
  id?: string;
  name: string;
  deny_hosts?: string[];
  allow_hosts?: string[];
  /** alias accepted from API docs */
  allow_domains?: string[];
  deny_domains?: string[];
  sanctions_action?: "block" | "warn" | "allow";
  suspicious_url_action?: "block" | "warn";
  block_on_warn?: boolean;
  max_amount_usdc?: number;
  daily_cap_usdc?: number;
  api_key?: string;
}): Policy {
  if (!policies.size) initPolicies();
  const id =
    input.id ||
    `pol_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = policies.get(id);
  const allow =
    input.allow_hosts ??
    input.allow_domains ??
    existing?.allow_hosts ??
    [...DEFAULT_ALLOW_HOSTS];
  const deny =
    input.deny_hosts ??
    input.deny_domains ??
    existing?.deny_hosts ??
    [...DEFAULT_DENY_HOSTS];
  const p: Policy = {
    id,
    name: input.name,
    deny_hosts: deny,
    allow_hosts: allow,
    sanctions_action: input.sanctions_action ?? existing?.sanctions_action ?? "block",
    suspicious_url_action:
      input.suspicious_url_action ?? existing?.suspicious_url_action ?? "warn",
    block_on_warn: input.block_on_warn ?? existing?.block_on_warn ?? false,
    max_amount_usdc:
      input.max_amount_usdc !== undefined
        ? input.max_amount_usdc
        : existing?.max_amount_usdc,
    daily_cap_usdc:
      input.daily_cap_usdc !== undefined
        ? input.daily_cap_usdc
        : existing?.daily_cap_usdc,
    created_at: existing?.created_at ?? new Date().toISOString(),
    api_key: input.api_key ?? existing?.api_key,
  };
  policies.set(id, p);
  persist();
  return p;
}

export function findPolicyByApiKey(apiKey: string): Policy | undefined {
  if (!policies.size) initPolicies();
  for (const p of policies.values()) {
    if (p.api_key && p.api_key === apiKey) return p;
  }
  return undefined;
}

export function listPolicies(): Policy[] {
  if (!policies.size) initPolicies();
  return [...policies.values()].map(({ api_key: _k, ...rest }) => rest as Policy);
}

// init on import
initPolicies();
