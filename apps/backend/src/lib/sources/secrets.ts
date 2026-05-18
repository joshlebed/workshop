// Per-source secrets — encrypt-at-application-layer envelope for the
// `list_sources.secrets` jsonb column (§3.5 of the redesign). The v1
// envelope uses Node's built-in AES-256-GCM with a key derived from
// `SESSION_SECRET` via HKDF-SHA-256; rotating SESSION_SECRET requires
// re-encrypting source rows.
//
// Scope today: no source kinds use secrets yet (Spotify uses app
// credentials; Letterboxd is unauthenticated). This module exists so the
// first OAuth-bearing source kind (Trakt, MAL, etc.) lands with the
// encryption story already in place rather than blocking on it.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getConfig } from "../config.js";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const INFO = Buffer.from("workshop-source-secrets/v1");

/** Envelope written to the `list_sources.secrets` jsonb column. */
interface SecretEnvelope {
  v: 1;
  /** Base64url-encoded random IV. */
  iv: string;
  /** Base64url-encoded ciphertext + auth tag concatenated. */
  ct: string;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const sessionSecret = getConfig().sessionSecret;
  // HKDF-SHA-256 derives a domain-separated key from the existing
  // SESSION_SECRET; this avoids a second secret in SSM while keeping the
  // source-secrets key distinct from the session-signing key.
  const salt = Buffer.from("workshop-source-secrets-salt/v1");
  const derived = hkdfSync("sha256", Buffer.from(sessionSecret), salt, INFO, KEY_LEN);
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

function toBase64Url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Buffer {
  const padded = s.padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Encrypt a JSON-serializable secrets payload into the envelope shape
 * written to `list_sources.secrets`. The plaintext leaves the request
 * scope only as ciphertext + IV.
 */
export function sealSecrets(secrets: Record<string, unknown>): SecretEnvelope {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) {
    throw new Error(`unexpected GCM tag length ${tag.length}`);
  }
  return {
    v: 1,
    iv: toBase64Url(iv),
    ct: toBase64Url(Buffer.concat([encrypted, tag])),
  };
}

export class SecretEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretEnvelopeError";
  }
}

/**
 * Decrypt a `list_sources.secrets` envelope. Throws `SecretEnvelopeError`
 * on tampering, wrong key, or corrupt input — callers should never
 * silently fall through; surface as a 500 (the source is unusable).
 */
export function openSecrets(envelope: unknown): Record<string, unknown> {
  if (!isEnvelope(envelope)) {
    throw new SecretEnvelopeError("invalid secret envelope shape");
  }
  if (envelope.v !== 1) {
    throw new SecretEnvelopeError(`unsupported envelope version ${envelope.v}`);
  }
  const iv = fromBase64Url(envelope.iv);
  if (iv.length !== IV_LEN) {
    throw new SecretEnvelopeError("invalid envelope iv length");
  }
  const ctTag = fromBase64Url(envelope.ct);
  if (ctTag.length < TAG_LEN + 1) {
    throw new SecretEnvelopeError("invalid envelope ciphertext length");
  }
  const ciphertext = ctTag.subarray(0, ctTag.length - TAG_LEN);
  const tag = ctTag.subarray(ctTag.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SecretEnvelopeError("secret envelope authentication failed");
  }
  try {
    const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SecretEnvelopeError("decrypted secrets must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof SecretEnvelopeError) throw e;
    throw new SecretEnvelopeError("decrypted secrets are not valid JSON");
  }
}

function isEnvelope(value: unknown): value is SecretEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.iv === "string" && typeof v.ct === "string" && typeof v.v === "number";
}

/** Exposed for testing — clears the memoized derived key. */
export function __resetKeyCacheForTesting(): void {
  cachedKey = null;
}
