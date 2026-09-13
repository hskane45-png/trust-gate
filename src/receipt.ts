/**
 * Ed25519 signed receipts + JWKS.
 * Keypair from RECEIPT_PRIVATE_KEY env or stable .data/keys.json on first boot.
 */

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import nacl from "tweetnacl";


function encodeBase64(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64");
}

function decodeBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}


export type Receipt = {
  id: string;
  ts: string;
  input_hash: string;
  verdict: string;
  reasons: string[];
  sig: string;
  kid: string;
};

export type KeyMaterial = {
  kid: string;
  publicKeyBase64: string;
  secretKeyBase64: string;
};

let cachedKeys: KeyMaterial | null = null;

function b64Url(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), ".data");
}

function keysPath(): string {
  return join(dataDir(), "keys.json");
}

function loadOrCreateKeys(): KeyMaterial {
  if (cachedKeys) return cachedKeys;

  const envKey = process.env.RECEIPT_PRIVATE_KEY;
  if (envKey) {
    const raw = Buffer.from(envKey.replace(/^0x/, ""), "hex");
    let kp: nacl.SignKeyPair;
    if (raw.length === 64) {
      kp = nacl.sign.keyPair.fromSecretKey(new Uint8Array(raw));
    } else if (raw.length === 32) {
      kp = nacl.sign.keyPair.fromSeed(new Uint8Array(raw));
    } else {
      throw new Error("RECEIPT_PRIVATE_KEY must be 32-byte seed or 64-byte secret key hex");
    }
    const kid = "env-" + createHash("sha256").update(kp.publicKey).digest("hex").slice(0, 16);
    cachedKeys = {
      kid,
      publicKeyBase64: encodeBase64(kp.publicKey),
      secretKeyBase64: encodeBase64(kp.secretKey),
    };
    return cachedKeys;
  }

  const path = keysPath();
  if (existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as KeyMaterial;
    cachedKeys = parsed;
    return cachedKeys;
  }

  const kp = nacl.sign.keyPair();
  const kid = "boot-" + createHash("sha256").update(kp.publicKey).digest("hex").slice(0, 16);
  const material: KeyMaterial = {
    kid,
    publicKeyBase64: encodeBase64(kp.publicKey),
    secretKeyBase64: encodeBase64(kp.secretKey),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(material, null, 2), { mode: 0o600 });
  cachedKeys = material;
  return material;
}

export function getKeys(): KeyMaterial {
  return loadOrCreateKeys();
}

export function inputHash(input: unknown): string {
  const canonical = JSON.stringify(input, Object.keys(input as object).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

function signingPayload(r: Omit<Receipt, "sig">): Uint8Array {
  const body = JSON.stringify({
    id: r.id,
    ts: r.ts,
    input_hash: r.input_hash,
    verdict: r.verdict,
    reasons: r.reasons,
    kid: r.kid,
  });
  return new TextEncoder().encode(body);
}

export function createReceipt(
  input: unknown,
  verdict: string,
  reasons: string[]
): Receipt {
  const keys = getKeys();
  const partial: Omit<Receipt, "sig"> = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    input_hash: inputHash(input),
    verdict,
    reasons: [...reasons],
    kid: keys.kid,
  };
  const secretKey = new Uint8Array(decodeBase64(keys.secretKeyBase64));
  const msg = new Uint8Array(signingPayload(partial));
  const sig = nacl.sign.detached(msg, secretKey);
  return { ...partial, sig: encodeBase64(sig) };
}

export function verifyReceipt(receipt: Receipt, publicKeyBase64?: string): boolean {
  const keys = getKeys();
  const pk = new Uint8Array(decodeBase64(publicKeyBase64 ?? keys.publicKeyBase64));
  const { sig, ...rest } = receipt;
  try {
    return nacl.sign.detached.verify(
      new Uint8Array(signingPayload(rest)),
      new Uint8Array(decodeBase64(sig)),
      pk
    );
  } catch {
    return false;
  }
}

export function jwks(): { keys: object[] } {
  const keys = getKeys();
  const pub = new Uint8Array(decodeBase64(keys.publicKeyBase64));
  // OKP Ed25519 JWK
  return {
    keys: [
      {
        kty: "OKP",
        crv: "Ed25519",
        kid: keys.kid,
        use: "sig",
        alg: "EdDSA",
        x: b64Url(pub),
      },
    ],
  };
}

/** In-memory receipt store for GET /v1/receipts/:id */
const receiptStore = new Map<string, Receipt>();

export function storeReceipt(r: Receipt): void {
  receiptStore.set(r.id, r);
}

export function getReceipt(id: string): Receipt | undefined {
  return receiptStore.get(id);
}
