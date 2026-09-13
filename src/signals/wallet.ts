/**
 * Destination wallet signals.
 * Format check + offline OFAC/sanctions address list loaded at boot.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type WalletSignalResult = {
  reasons: string[];
  severity: "ok" | "warn" | "block";
  signals: Record<string, unknown>;
};

/**
 * Clearly fake demo addresses kept for local demos / tests.
 * Merged with the offline OFAC file when present.
 */
export const DEMO_SANCTIONS_STUB = new Set(
  [
    "0x000000000000000000000000000000000000dead",
    "0x1111111111111111111111111111111111111111",
    "0xbad0000000000000000000000000000000000001",
    "0xdead000000000000000000000000000000000001",
    "0xdead000000000000000000000000000000000002",
    "0xdeadbeef00000000000000000000000000000001",
    "0xdeadbeef00000000000000000000000000000002",
  ].map((a) => a.toLowerCase())
);

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

let loadedSanctions: Set<string> = new Set([...DEMO_SANCTIONS_STUB]);
let sanctionsSource = "demo_stub_only";
let sanctionsLoaded = false;

function resolveDataPath(filename: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "data", filename);
}

/**
 * Load offline sanctions file at boot.
 * Prefers data/ofac-eth-addresses.json (community OFAC ETH list).
 */
export function loadSanctionsList(pathOverride?: string): {
  count: number;
  source: string;
} {
  const candidates = pathOverride
    ? [pathOverride]
    : [
        resolveDataPath("ofac-eth-addresses.json"),
        resolveDataPath("sanctions-demo.json"),
        join(process.cwd(), "data", "ofac-eth-addresses.json"),
        join(process.cwd(), "data", "sanctions-demo.json"),
      ];

  const set = new Set<string>([...DEMO_SANCTIONS_STUB]);
  let source = "demo_stub_only";

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as unknown;
      const addrs: string[] = Array.isArray(raw)
        ? (raw as string[])
        : Array.isArray((raw as { addresses?: string[] })?.addresses)
          ? (raw as { addresses: string[] }).addresses
          : [];
      for (const a of addrs) {
        if (typeof a === "string" && a.startsWith("0x")) {
          set.add(a.toLowerCase());
        }
      }
      source = `file:${p}`;
      break;
    } catch {
      // try next
    }
  }

  loadedSanctions = set;
  sanctionsSource = source;
  sanctionsLoaded = true;
  return { count: set.size, source };
}

export function getSanctionsSet(): Set<string> {
  if (!sanctionsLoaded) loadSanctionsList();
  return loadedSanctions;
}

export function getSanctionsSource(): string {
  if (!sanctionsLoaded) loadSanctionsList();
  return sanctionsSource;
}

/** Back-compat alias — populated after loadSanctionsList(). */
export const REAL_SANCTIONS_LIST: Set<string> = loadedSanctions;

export function isValidEvmAddress(addr: string): boolean {
  return EVM_ADDRESS_RE.test(addr);
}

export function analyzeWallet(
  wallet: string | undefined,
  opts?: { sanctions?: Set<string> }
): WalletSignalResult {
  const reasons: string[] = [];
  const signals: Record<string, unknown> = {
    ofac_source: getSanctionsSource(),
    sanctions_count: getSanctionsSet().size,
  };
  let severity: "ok" | "warn" | "block" = "ok";

  if (!wallet) {
    signals.wallet_present = false;
    return { reasons, severity, signals };
  }

  signals.wallet_present = true;
  const normalized = wallet.toLowerCase();
  signals.wallet = normalized;

  if (!isValidEvmAddress(wallet)) {
    reasons.push("wallet_invalid_format");
    signals.format_ok = false;
    return { reasons, severity: "block", signals };
  }

  signals.format_ok = true;

  const sanctions = opts?.sanctions ?? getSanctionsSet();
  if (sanctions.has(normalized)) {
    reasons.push("wallet_on_sanctions");
    if (DEMO_SANCTIONS_STUB.has(normalized)) {
      reasons.push("wallet_on_sanctions_stub");
    }
    signals.sanctions_hit = true;
    severity = "block";
  }

  return { reasons, severity, signals };
}

loadSanctionsList();
