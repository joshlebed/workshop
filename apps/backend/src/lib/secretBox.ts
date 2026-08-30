// Symmetric sealing for the handful of third-party secrets we have to keep at
// rest (today: Apple refresh tokens on `user_identities`, held solely so
// account deletion can call Apple's revoke endpoint).
//
// AES-256-GCM with a key derived from `SESSION_SECRET` via HKDF-SHA256 and a
// per-purpose `info` string, so a leaked ciphertext is useless without the
// Lambda env and one purpose's key can't decrypt another's. There is no key
// rotation surface: the values are disposable — if `SESSION_SECRET` ever
// changes, `open()` returns null, the token is treated as absent, and the
// user's next sign-in re-seals a fresh one.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { getConfig } from "./config.js";

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function keyFor(purpose: string): Buffer {
  const secret = getConfig().sessionSecret;
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.alloc(0),
      `secretbox:${purpose}`,
      KEY_BYTES,
    ),
  );
}

/**
 * Seal `plaintext` for `purpose`. Returns `v1.<iv>.<tag>.<ciphertext>`, all
 * base64url. Never throws for ordinary input.
 */
export function seal(purpose: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Unseal a value produced by {@link seal}. Returns null for anything that
 * doesn't authenticate — wrong purpose, tampered bytes, rotated secret, or an
 * unrecognised envelope version. Callers treat null as "no token available".
 */
export function open(purpose: string, sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4) return null;
  const [version, ivPart, tagPart, ctPart] = parts;
  if (version !== VERSION || !ivPart || !tagPart || !ctPart) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(purpose),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** Purpose string for provider refresh tokens on `user_identities`. */
export const PROVIDER_REFRESH_TOKEN_PURPOSE = "provider-refresh-token";
