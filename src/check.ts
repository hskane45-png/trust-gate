/**
 * Verdict logic: screen DESTINATION (payee wallet + URL) under policy.
 */

import {
  getPolicy,
  getDailySpend,
  recordDailySpend,
  type Policy,
} from "./policy.js";
import { analyzeUrl } from "./signals/url.js";
import { analyzeWallet, getSanctionsSet } from "./signals/wallet.js";
import { createReceipt, storeReceipt, type Receipt } from "./receipt.js";

export type CheckInput = {
  wallet?: string;
  url?: string;
  payee?: string;
  amount_usdc?: number;
  agent_wallet?: string;
  policy_id?: string;
};

export type Verdict = "ALLOW" | "WARN" | "BLOCK";

export type CheckResult = {
  verdict: Verdict;
  reasons: string[];
  signals: Record<string, unknown>;
  receipt: Receipt;
};

function severityRank(s: "ok" | "warn" | "block"): number {
  if (s === "block") return 2;
  if (s === "warn") return 1;
  return 0;
}

function applyPolicyToUrlSeverity(
  sev: "ok" | "warn" | "block",
  policy: Policy
): "ok" | "warn" | "block" {
  if (sev === "ok") return "ok";
  if (sev === "block") return "block";
  return policy.suspicious_url_action === "block" ? "block" : "warn";
}

export function runCheck(input: CheckInput): CheckResult {
  const wallet = input.wallet || input.payee;
  const url = input.url;

  if (!wallet && !url) {
    throw new Error("At least one of wallet or url is required");
  }

  const policy = getPolicy(input.policy_id);
  const reasons: string[] = [];
  const signals: Record<string, unknown> = {
    policy_id: policy.id,
    agent_wallet: input.agent_wallet ?? null,
    amount_usdc: input.amount_usdc ?? null,
  };

  const urlResult = analyzeUrl(url, {
    amountUsdc: input.amount_usdc,
    denyHosts: new Set(policy.deny_hosts),
    allowHosts: new Set(policy.allow_hosts),
  });
  reasons.push(...urlResult.reasons);
  signals.url = urlResult.signals;

  let urlSev = applyPolicyToUrlSeverity(urlResult.severity, policy);
  if (urlResult.reasons.includes("url_deny_listed")) {
    urlSev = "block";
  }

  const walletResult = analyzeWallet(wallet, {
    sanctions: getSanctionsSet(),
  });
  const walletReasons = [...walletResult.reasons];
  let walletSev = walletResult.severity;
  const sanctionsHit =
    walletReasons.includes("wallet_on_sanctions") ||
    walletReasons.includes("wallet_on_sanctions_stub");
  if (sanctionsHit) {
    if (policy.sanctions_action === "allow") {
      for (const r of ["wallet_on_sanctions", "wallet_on_sanctions_stub"]) {
        const i = walletReasons.indexOf(r);
        if (i >= 0) walletReasons.splice(i, 1);
      }
      walletSev = "ok";
    } else if (policy.sanctions_action === "warn") {
      walletSev = "warn";
    } else {
      walletSev = "block";
    }
  }
  reasons.push(...walletReasons);
  signals.wallet = walletResult.signals;

  const amount = input.amount_usdc;
  if (amount !== undefined && amount > 0) {
    if (
      policy.max_amount_usdc !== undefined &&
      amount > policy.max_amount_usdc
    ) {
      reasons.push("amount_exceeds_max");
      signals.amount_cap = {
        max_amount_usdc: policy.max_amount_usdc,
        requested: amount,
      };
      urlSev = "block";
    }
    if (policy.daily_cap_usdc !== undefined) {
      const spent = getDailySpend(policy.id);
      signals.daily_spend_usdc = spent;
      signals.daily_cap_usdc = policy.daily_cap_usdc;
      if (spent + amount > policy.daily_cap_usdc) {
        reasons.push("amount_exceeds_daily_cap");
        urlSev = "block";
      }
    }
  }

  let rank = Math.max(severityRank(urlSev), severityRank(walletSev));
  let verdict: Verdict = rank >= 2 ? "BLOCK" : rank === 1 ? "WARN" : "ALLOW";

  if (policy.block_on_warn && verdict === "WARN") {
    reasons.push("policy_block_on_warn");
    verdict = "BLOCK";
  }

  const hashInput = {
    wallet: wallet ?? null,
    url: url ?? null,
    payee: input.payee ?? null,
    amount_usdc: input.amount_usdc ?? null,
    agent_wallet: input.agent_wallet ?? null,
    policy_id: policy.id,
  };

  const receipt = createReceipt(hashInput, verdict, reasons);
  storeReceipt(receipt);

  if (verdict !== "BLOCK" && amount !== undefined && amount > 0) {
    recordDailySpend(policy.id, amount);
  }

  return { verdict, reasons, signals, receipt };
}
