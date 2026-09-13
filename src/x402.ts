/**
 * x402 payment gate for POST /v1/check.
 * MOCK_MODE=1: skip chain, just run check.
 * MOCK_MODE=0: return proper 402 Payment Required shape (exact scheme, Base USDC).
 * Does not require a live facilitator for tests.
 */

import type { Context, Next } from "hono";

export type X402Accepts = {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type PaymentRequiredBody = {
  x402Version: number;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: X402Accepts[];
};

export function isMockMode(): boolean {
  const v = process.env.MOCK_MODE;
  if (v === undefined || v === "") return true;
  return v === "1" || v.toLowerCase() === "true";
}

export function buildPaymentRequired(reqUrl: string): PaymentRequiredBody {
  const network = process.env.X402_NETWORK || "eip155:8453";
  const amount = process.env.X402_AMOUNT || "20000"; // 0.02 USDC
  const asset =
    process.env.X402_USDC_ASSET || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA0C29E";
  const payTo =
    process.env.X402_PAY_TO || "0x0000000000000000000000000000000000000001";

  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: {
      url: reqUrl,
      description: "Trust Gate destination check ($0.02 USDC / check)",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network,
        amount,
        asset,
        payTo,
        maxTimeoutSeconds: 60,
        extra: { name: "USDC", version: "2" },
      },
    ],
  };
}

/**
 * Best-effort verify: when not mock, require PAYMENT-SIGNATURE header presence.
 * Full facilitator settle is out of scope (no paid APIs / no live chain required).
 * If header present, treat as paid for MVP (documented as stub verify).
 */
export function hasPaymentSignature(c: Context): boolean {
  return Boolean(
    c.req.header("PAYMENT-SIGNATURE") ||
      c.req.header("payment-signature") ||
      c.req.header("X-PAYMENT")
  );
}

export async function x402Middleware(c: Context, next: Next) {
  if (isMockMode()) {
    c.set("x402_mock", true);
    return next();
  }

  if (hasPaymentSignature(c)) {
    // Stub: accept any PAYMENT-SIGNATURE without facilitator settle.
    c.set("x402_mock", false);
    c.set("x402_paid_stub", true);
    await next();
    // Optionally attach PAYMENT-RESPONSE stub
    c.header(
      "PAYMENT-RESPONSE",
      Buffer.from(
        JSON.stringify({
          success: true,
          stub: true,
          note: "Facilitator settle not performed; header presence accepted in non-mock MVP",
        })
      ).toString("base64")
    );
    return;
  }

  const body = buildPaymentRequired(c.req.url);
  const encoded = Buffer.from(JSON.stringify(body)).toString("base64");
  c.header("PAYMENT-REQUIRED", encoded);
  return c.json(body, 402);
}
