/**
 * Destination URL heuristics for Trust Gate.
 * Screens the spend destination URL — not caller reputation.
 */

export type UrlSignalResult = {
  reasons: string[];
  severity: "ok" | "warn" | "block";
  signals: Record<string, unknown>;
};

const DEFAULT_DENY_HOSTS = new Set([
  "evil.example",
  "phishing.example",
  "malware.test",
  "steal-crypto.invalid",
  "fake-uniswap.com",
  "metamask-airdrop.tk",
  "drain-wallet.example",
  "free-mint.rug",
]);

const DEFAULT_ALLOW_HOSTS = new Set([
  "api.coinbase.com",
  "base.org",
  "docs.base.org",
  "github.com",
  "api.github.com",
]);

/** Path/query keywords often seen in crypto-drain / phishing flows */
const DRAIN_BLOCK_KEYWORDS = ["seed", "mnemonic", "private-key", "privatekey"];
const DRAIN_WARN_KEYWORDS = [
  "approve",
  "permit",
  "claim-airdrop",
  "claim_airdrop",
  "airdrop-claim",
  "drain",
  "setapprovalforall",
];

function parseUrl(raw: string): {
  host: string;
  protocol: string;
  href: string;
  pathname: string;
  search: string;
  username?: string;
  password?: string;
} | null {
  try {
    const u = new URL(raw);
    return {
      host: u.hostname.toLowerCase(),
      protocol: u.protocol.replace(":", "").toLowerCase(),
      href: u.href,
      pathname: u.pathname.toLowerCase(),
      search: u.search.toLowerCase(),
      username: u.username || undefined,
      password: u.password || undefined,
    };
  } catch {
    return null;
  }
}

function isIpHost(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  const h = host.replace(/^\[|\]$/g, "");
  if (h.includes(":")) return true;
  return false;
}

function parseIpv4(host: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split(".").map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

/** localhost, loopback, RFC1918, link-local */
function isPrivateOrLocalHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") {
    return true;
  }
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true;

  const ip = parseIpv4(host);
  if (!ip) return false;
  const [a, b] = ip;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function hasPunycode(host: string): boolean {
  return host.includes("xn--");
}

function hostMatches(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase();
  const h = host.toLowerCase();
  if (p.startsWith("*.")) {
    const suffix = p.slice(1); // ".coinbase.com"
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p || h.endsWith(`.${p}`);
}

function denyListed(host: string, deny: Set<string>): boolean {
  for (const d of deny) {
    if (hostMatches(d, host) || host === d.toLowerCase()) return true;
  }
  return false;
}

function allowListed(host: string, allow: Set<string>): boolean {
  for (const a of allow) {
    if (a.startsWith("*.")) {
      if (hostMatches(a, host)) return true;
    } else if (host === a.toLowerCase()) {
      return true;
    }
  }
  return false;
}

function bump(
  severity: "ok" | "warn" | "block",
  next: "warn" | "block"
): "ok" | "warn" | "block" {
  if (severity === "block" || next === "block") return "block";
  if (severity === "warn" || next === "warn") return "warn";
  return "ok";
}

export function analyzeUrl(
  url: string | undefined,
  opts?: {
    amountUsdc?: number;
    denyHosts?: Set<string>;
    allowHosts?: Set<string>;
  }
): UrlSignalResult {
  const reasons: string[] = [];
  const signals: Record<string, unknown> = {};
  let severity: "ok" | "warn" | "block" = "ok";

  if (!url) {
    signals.url_present = false;
    return { reasons, severity, signals };
  }

  signals.url_present = true;

  // Block dangerous schemes before URL parse quirks
  const lower = url.trim().toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("file:")) {
    reasons.push(
      lower.startsWith("javascript:") ? "url_javascript_scheme" : "url_file_scheme"
    );
    signals.url_parse_ok = false;
    return { reasons, severity: "block", signals };
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    reasons.push("url_unparseable");
    signals.url_parse_ok = false;
    return { reasons, severity: "block", signals };
  }

  signals.url_parse_ok = true;
  signals.host = parsed.host;
  signals.protocol = parsed.protocol;

  const deny = opts?.denyHosts ?? DEFAULT_DENY_HOSTS;
  const allow = opts?.allowHosts ?? DEFAULT_ALLOW_HOSTS;
  const amount = opts?.amountUsdc;
  const hasAmount = amount !== undefined && amount > 0;

  if (denyListed(parsed.host, deny)) {
    reasons.push("url_deny_listed");
    signals.deny_listed = true;
    severity = "block";
  }

  if (allowListed(parsed.host, allow)) {
    signals.allow_listed = true;
  }

  if (parsed.protocol === "javascript") {
    reasons.push("url_javascript_scheme");
    severity = "block";
  } else if (parsed.protocol === "file") {
    reasons.push("url_file_scheme");
    severity = "block";
  } else if (parsed.protocol !== "https" && parsed.protocol !== "http") {
    reasons.push("url_unusual_scheme");
    severity = bump(severity, "warn");
  }

  if (parsed.protocol !== "https") {
    if (hasAmount) {
      reasons.push("url_non_https_with_amount");
      signals.non_https_with_amount = true;
      severity = bump(severity, "warn");
    } else if (parsed.protocol === "http") {
      reasons.push("url_non_https");
      severity = bump(severity, "warn");
    }
  }

  if (isPrivateOrLocalHost(parsed.host)) {
    signals.private_or_local_host = true;
    if (hasAmount) {
      reasons.push("url_localhost_or_private_ip_with_amount");
      severity = "block";
    } else {
      reasons.push("url_localhost_or_private_ip");
      severity = bump(severity, "warn");
    }
  } else if (isIpHost(parsed.host)) {
    reasons.push("url_ip_host");
    signals.ip_host = true;
    severity = bump(severity, "warn");
  }

  // @ userinfo — phishing classic (already blocked when username/password present)
  if (parsed.username || parsed.password || /https?:\/\/[^/]*@/.test(url)) {
    reasons.push("url_credentials_embedded");
    signals.credentials_in_url = true;
    severity = "block";
  }

  if (hasPunycode(parsed.host)) {
    reasons.push("url_punycode_host");
    signals.punycode = true;
    severity = bump(severity, "warn");
  }

  // Homoglyph / non-ASCII host
  if (/[^\x00-\x7F]/.test(parsed.host) && !hasPunycode(parsed.host)) {
    reasons.push("url_non_ascii_host");
    signals.homoglyph = true;
    severity = bump(severity, "warn");
  }

  // Very long subdomain / hostname
  const labels = parsed.host.split(".").filter(Boolean);
  const longLabel = labels.some((l) => l.length > 40);
  if (labels.length >= 5 || parsed.host.length > 64 || longLabel) {
    reasons.push("url_long_subdomain");
    signals.long_subdomain = true;
    severity = bump(severity, "warn");
  }

  // Crypto-drain path / query keywords
  const pathAndQuery = `${parsed.pathname}${parsed.search}`;
  for (const kw of DRAIN_BLOCK_KEYWORDS) {
    if (pathAndQuery.includes(kw)) {
      reasons.push("url_drain_keyword_block");
      signals.drain_keyword = kw;
      severity = "block";
      break;
    }
  }
  if (!reasons.includes("url_drain_keyword_block")) {
    for (const kw of DRAIN_WARN_KEYWORDS) {
      if (pathAndQuery.includes(kw)) {
        reasons.push("url_drain_keyword_warn");
        signals.drain_keyword = kw;
        severity = bump(severity, "warn");
        break;
      }
    }
  }

  return { reasons, severity, signals };
}

export {
  DEFAULT_DENY_HOSTS,
  DEFAULT_ALLOW_HOSTS,
  hostMatches,
  allowListed,
  denyListed,
};
