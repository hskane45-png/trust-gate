import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { runCheck } from "../src/check.js";
import { analyzeUrl } from "../src/signals/url.js";
import {
  analyzeWallet,
  DEMO_SANCTIONS_STUB,
  getSanctionsSet,
  loadSanctionsList,
} from "../src/signals/wallet.js";
import { createReceipt, verifyReceipt, jwks, getKeys } from "../src/receipt.js";
import {
  getPolicy,
  upsertPolicy,
  initPolicies,
  resetDailySpend,
  DEMO_BUSINESS_POLICY_ID,
} from "../src/policy.js";
import nacl from "tweetnacl";
const decodeBase64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

beforeAll(() => {
  process.env.MOCK_MODE = "1";
  loadSanctionsList();
  initPolicies();
  getKeys();
});

beforeEach(() => {
  resetDailySpend();
  initPolicies();
});

describe("URL signals", () => {
  it("flags deny-listed hosts as block", () => {
    const r = analyzeUrl("https://phishing.example/pay");
    expect(r.severity).toBe("block");
    expect(r.reasons).toContain("url_deny_listed");
  });

  it("blocks new demo deny domains", () => {
    expect(analyzeUrl("https://drain-wallet.example/x").severity).toBe("block");
    expect(analyzeUrl("https://free-mint.rug/claim").severity).toBe("block");
  });

  it("warns on non-https with amount", () => {
    const r = analyzeUrl("http://example.com/pay", { amountUsdc: 1.5 });
    expect(r.reasons).toContain("url_non_https_with_amount");
    expect(r.severity).toBe("warn");
  });

  it("blocks credentials / @ userinfo in URL", () => {
    const r = analyzeUrl("https://user:pass@example.com/");
    expect(r.severity).toBe("block");
    expect(r.reasons).toContain("url_credentials_embedded");
  });

  it("warns on IP host", () => {
    const r = analyzeUrl("https://8.8.8.8/api");
    expect(r.reasons).toContain("url_ip_host");
    expect(["warn", "block"]).toContain(r.severity);
  });

  it("blocks localhost/private IP when amount present", () => {
    const r = analyzeUrl("https://127.0.0.1/pay", { amountUsdc: 1 });
    expect(r.severity).toBe("block");
    expect(r.reasons).toContain("url_localhost_or_private_ip_with_amount");
    const r2 = analyzeUrl("https://192.168.0.5/pay", { amountUsdc: 2 });
    expect(r2.severity).toBe("block");
    const r3 = analyzeUrl("https://localhost/pay", { amountUsdc: 1 });
    expect(r3.severity).toBe("block");
  });

  it("warns on punycode / homoglyph", () => {
    const r = analyzeUrl("https://xn--e1awh7c.example/");
    expect(r.reasons).toContain("url_punycode_host");
  });

  it("warns on very long subdomain", () => {
    const long = "a".repeat(45);
    const r = analyzeUrl(`https://${long}.example.com/`);
    expect(r.reasons).toContain("url_long_subdomain");
    expect(r.severity).toBe("warn");
  });

  it("blocks file: and javascript: schemes", () => {
    expect(analyzeUrl("javascript:alert(1)").severity).toBe("block");
    expect(analyzeUrl("javascript:alert(1)").reasons).toContain(
      "url_javascript_scheme"
    );
    expect(analyzeUrl("file:///etc/passwd").severity).toBe("block");
    expect(analyzeUrl("file:///etc/passwd").reasons).toContain("url_file_scheme");
  });

  it("flags crypto-drain path keywords", () => {
    const warn = analyzeUrl("https://example.com/claim-airdrop");
    expect(warn.reasons).toContain("url_drain_keyword_warn");
    expect(["warn", "block"]).toContain(warn.severity);

    const block = analyzeUrl("https://example.com/export-mnemonic");
    expect(block.reasons).toContain("url_drain_keyword_block");
    expect(block.severity).toBe("block");

    const approve = analyzeUrl("https://example.com/permit");
    expect(approve.reasons).toContain("url_drain_keyword_warn");
  });

  it("allows clean https", () => {
    const r = analyzeUrl("https://api.github.com/repos");
    expect(r.severity).toBe("ok");
  });
});

describe("wallet signals", () => {
  it("blocks invalid format", () => {
    const r = analyzeWallet("not-an-address");
    expect(r.severity).toBe("block");
    expect(r.reasons).toContain("wallet_invalid_format");
  });

  it("blocks demo sanctions stub", () => {
    const addr = [...DEMO_SANCTIONS_STUB][0];
    const r = analyzeWallet(addr);
    expect(r.severity).toBe("block");
    expect(r.reasons).toContain("wallet_on_sanctions_stub");
    expect(r.reasons).toContain("wallet_on_sanctions");
  });

  it("loads offline OFAC list and blocks exact match case-insensitive", () => {
    const set = getSanctionsSet();
    expect(set.size).toBeGreaterThan(20);
    // first address from bundled community OFAC list
    const hit = "0x0330070FD38Ec3bB94F58FA55D40368271E9e54A";
    expect(set.has(hit.toLowerCase())).toBe(true);
    const r = analyzeWallet(hit);
    expect(r.severity).toBe("block");
    expect(r.reasons).toContain("wallet_on_sanctions");
  });

  it("ok on random valid wallet", () => {
    const r = analyzeWallet("0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
    expect(r.severity).toBe("ok");
  });
});

describe("policy", () => {
  it("has default policy", () => {
    const p = getPolicy();
    expect(p.id).toBe("default");
    expect(p.deny_hosts.length).toBeGreaterThan(0);
  });

  it("seeds demo-business policy", () => {
    const p = getPolicy(DEMO_BUSINESS_POLICY_ID);
    expect(p.id).toBe("demo-business");
    expect(p.allow_hosts).toContain("docs.base.org");
    expect(p.allow_hosts).toContain("*.coinbase.com");
    expect(p.deny_hosts).toContain("phishing.example");
    expect(p.max_amount_usdc).toBe(100);
    expect(p.daily_cap_usdc).toBe(500);
    expect(p.block_on_warn).toBe(true);
  });

  it("upserts business policy", () => {
    const p = upsertPolicy({
      name: "Acme",
      deny_hosts: ["evil.acme.test"],
    });
    expect(p.name).toBe("Acme");
    expect(getPolicy(p.id).deny_hosts).toContain("evil.acme.test");
  });
});

describe("receipt", () => {
  it("signs and verifies", () => {
    const r = createReceipt({ url: "https://example.com", wallet: null }, "ALLOW", []);
    expect(verifyReceipt(r)).toBe(true);
  });

  it("JWKS matches signing key", () => {
    const keys = getKeys();
    const doc = jwks();
    expect(doc.keys[0]).toMatchObject({ kty: "OKP", crv: "Ed25519", kid: keys.kid });
    const r = createReceipt({ a: 1 }, "WARN", ["x"]);
    const pub = decodeBase64(keys.publicKeyBase64);
    const payload = new TextEncoder().encode(
      JSON.stringify({
        id: r.id,
        ts: r.ts,
        input_hash: r.input_hash,
        verdict: r.verdict,
        reasons: r.reasons,
        kid: r.kid,
      })
    );
    expect(nacl.sign.detached.verify(payload, decodeBase64(r.sig), pub)).toBe(true);
  });
});

describe("runCheck", () => {
  it("requires wallet or url", () => {
    expect(() => runCheck({})).toThrow(/wallet or url/i);
  });

  it("ALLOW on clean https + random wallet", () => {
    const r = runCheck({
      url: "https://docs.base.org/",
      wallet: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      amount_usdc: 0.5,
    });
    expect(r.verdict).toBe("ALLOW");
    expect(r.receipt.sig).toBeTruthy();
    expect(verifyReceipt(r.receipt)).toBe(true);
  });

  it("BLOCK on deny-listed / phishing-ish URL", () => {
    const r = runCheck({ url: "https://phishing.example/drain" });
    expect(r.verdict).toBe("BLOCK");
    expect(r.reasons).toContain("url_deny_listed");
  });

  it("WARN or BLOCK on suspicious http URL with amount", () => {
    const r = runCheck({
      url: "http://random-site.example/checkout",
      amount_usdc: 10,
    });
    expect(["WARN", "BLOCK"]).toContain(r.verdict);
  });

  it("BLOCK on sanctions stub wallet", () => {
    const r = runCheck({ wallet: "0x000000000000000000000000000000000000dEaD" });
    expect(r.verdict).toBe("BLOCK");
  });

  it("demo-business BLOCKs deny domain even if default would differ", () => {
    // phishing.example is deny-listed on both, but ensure policy_id is applied
    const r = runCheck({
      url: "https://phishing.example/legit-looking",
      amount_usdc: 1,
      policy_id: "demo-business",
    });
    expect(r.verdict).toBe("BLOCK");
    expect(r.reasons).toContain("url_deny_listed");
    expect(r.signals.policy_id).toBe("demo-business");
  });

  it("demo-business ALLOW on docs.base.org under cap", () => {
    const r = runCheck({
      url: "https://docs.base.org/",
      wallet: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      amount_usdc: 0.5,
      policy_id: "demo-business",
    });
    expect(r.verdict).toBe("ALLOW");
    expect(r.signals.policy_id).toBe("demo-business");
  });

  it("demo-business BLOCKs amount over max_amount_usdc", () => {
    const r = runCheck({
      url: "https://docs.base.org/",
      wallet: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      amount_usdc: 150,
      policy_id: "demo-business",
    });
    expect(r.verdict).toBe("BLOCK");
    expect(r.reasons).toContain("amount_exceeds_max");
  });

  it("demo-business escalates WARN to BLOCK via block_on_warn", () => {
    const long = "a".repeat(45);
    const r = runCheck({
      url: `https://${long}.innocuous-site.example/`,
      amount_usdc: 1,
      policy_id: "demo-business",
    });
    expect(r.verdict).toBe("BLOCK");
    expect(
      r.reasons.includes("policy_block_on_warn") ||
        r.reasons.includes("url_long_subdomain")
    ).toBe(true);
  });
});
