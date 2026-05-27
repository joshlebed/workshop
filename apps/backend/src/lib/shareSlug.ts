import { randomBytes } from "node:crypto";

/**
 * Generate an 8-char base62 share slug. Uses crypto.randomBytes for unbiased
 * sampling — rejection-samples bytes whose value would wrap around the 62-char
 * alphabet rather than `%`-modding (which biases the first two glyphs).
 *
 * Namespace is 62^8 ≈ 2.18e14, so collision probability stays negligible even
 * at hundreds of thousands of lists. Callers should still retry on a
 * `unique_violation` from Postgres — it's not theoretical at scale, just rare.
 */
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ALPHABET_LEN = ALPHABET.length;
const SLUG_LEN = 8;
// Largest multiple of 62 ≤ 256. Bytes ≥ this are rejected to keep the
// distribution uniform over the 62-char alphabet.
const REJECT_THRESHOLD = Math.floor(256 / ALPHABET_LEN) * ALPHABET_LEN;

export function generateShareSlug(): string {
  let out = "";
  while (out.length < SLUG_LEN) {
    const buf = randomBytes(SLUG_LEN * 2);
    for (let i = 0; i < buf.length && out.length < SLUG_LEN; i++) {
      const byte = buf[i] ?? 0;
      if (byte >= REJECT_THRESHOLD) continue;
      out += ALPHABET.charAt(byte % ALPHABET_LEN);
    }
  }
  return out;
}

const SHARE_SLUG_RE = /^[A-Za-z0-9]{1,32}$/;

export function isValidShareSlug(s: string): boolean {
  return SHARE_SLUG_RE.test(s);
}
