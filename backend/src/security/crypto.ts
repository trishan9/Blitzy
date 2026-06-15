import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const ENVELOPE_VERSION = "1";

export type CryptoPurpose =
  | "pii:email"
  | "pii:phone"
  | "pii:address"
  | "webhook:secret"
  | "generic";

let cachedMaster: Buffer | null = null;
const dekCache = new Map<string, Buffer>();

function masterKey(): Buffer {
  if (cachedMaster) return cachedMaster;
  const b64 = process.env.CRYPTO_MASTER_KEY;
  if (!b64) throw new Error("CRYPTO_MASTER_KEY is not set");
  const raw = Buffer.from(b64, "base64");
  if (raw.length < KEY_LEN) {
    throw new Error(
      `CRYPTO_MASTER_KEY must decode to >= ${KEY_LEN} bytes (got ${raw.length})`
    );
  }
  cachedMaster = raw.subarray(0, KEY_LEN);
  return cachedMaster;
}

function currentKeyVersion(): number {
  const v = Number(process.env.CRYPTO_KEY_VERSION ?? "1");
  if (!Number.isInteger(v) || v < 1) throw new Error("CRYPTO_KEY_VERSION must be a positive integer");
  return v;
}

function deriveDek(purpose: CryptoPurpose, version: number): Buffer {
  const cacheKey = `${version}:${purpose}`;
  const hit = dekCache.get(cacheKey);
  if (hit) return hit;
  const dek = Buffer.from(
    hkdfSync(
      "sha256",
      masterKey(),
      Buffer.from(`v${version}`), // salt = key version
      Buffer.from(`ecom:dek:${purpose}`), // info = purpose
      KEY_LEN
    )
  );
  dekCache.set(cacheKey, dek);
  return dek;
}

const b64url = (b: Buffer): string => b.toString("base64url");
const fromB64url = (s: string): Buffer => Buffer.from(s, "base64url");

export function encrypt(plaintext: string, purpose: CryptoPurpose = "generic"): string {
  const version = currentKeyVersion();
  const key = deriveDek(purpose, version);
  const nonce = randomBytes(NONCE_LEN);
  const aad = Buffer.from(`${ENVELOPE_VERSION}.${version}.${purpose}`);

  const cipher = createCipheriv(ALGO, key, nonce, { authTagLength: TAG_LEN });
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([ct, tag]);

  return `${ENVELOPE_VERSION}.${version}.${purpose}.${b64url(nonce)}.${b64url(payload)}`;
}

export function decrypt(envelope: string, expectedPurpose?: CryptoPurpose): string {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("crypto: malformed envelope");
  }
  const [, versionStr, purpose, nonceB64, payloadB64] = parts;
  if (expectedPurpose && purpose !== expectedPurpose) {
    throw new Error(`crypto: purpose mismatch (want ${expectedPurpose}, got ${purpose})`);
  }
  const version = Number(versionStr);
  if (!Number.isInteger(version) || version < 1) throw new Error("crypto: bad key version");

  const key = deriveDek(purpose as CryptoPurpose, version);
  const nonce = fromB64url(nonceB64);
  const payload = fromB64url(payloadB64);
  if (payload.length < TAG_LEN) throw new Error("crypto: ciphertext too short");

  const ct = payload.subarray(0, payload.length - TAG_LEN);
  const tag = payload.subarray(payload.length - TAG_LEN);
  const aad = Buffer.from(`${ENVELOPE_VERSION}.${version}.${purpose}`);

  const decipher = createDecipheriv(ALGO, key, nonce, { authTagLength: TAG_LEN });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function encryptNullable(
  plaintext: string | null | undefined,
  purpose: CryptoPurpose = "generic"
): string | null {
  return plaintext == null ? null : encrypt(plaintext, purpose);
}

export function decryptNullable(
  envelope: string | null | undefined,
  expectedPurpose?: CryptoPurpose
): string | null {
  return envelope == null ? null : decrypt(envelope, expectedPurpose);
}

export function blindIndex(value: string, purpose: CryptoPurpose = "pii:email"): string {
  const pepper = process.env.BLIND_INDEX_PEPPER;
  if (!pepper) throw new Error("BLIND_INDEX_PEPPER is not set");
  const normalised = value.trim().toLowerCase();
  return createHmac("sha256", `${pepper}:${purpose}`).update(normalised).digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  const ha = createHmac("sha256", "cmp").update(ab).digest();
  const hb = createHmac("sha256", "cmp").update(bb).digest();
  return timingSafeEqual(ha, hb);
}
