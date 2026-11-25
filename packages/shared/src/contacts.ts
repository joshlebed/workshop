// Contacts "find and invite" (onboarding spike #3) — the one module both ends
// share for what a contact handle is and how it is hashed.
//
// Runtime subpath (`@workshop/shared/contacts`): the HighScore client imports
// values from here at runtime, so this file value-imports no sibling (Metro
// can't resolve `./x.js` from a package subpath — root CLAUDE.md).
//
// The scheme, end to end:
//   1. On the device, each email / phone number from a contact the user shared
//      is normalized (`normalizeEmail`, `normalizePhoneE164`) and turned into
//      `contactHandleDigest(kind, normalized)` = SHA-256 hex of a domain-
//      separated string. Only these digests leave the phone.
//   2. The server never stores a digest it was sent. It peppers each one
//      (HMAC-SHA256 with a server-only secret, `apps/backend/src/lib/contactHandles.ts`)
//      and looks the result up in `user_contact_handles`, then forgets it.
//   3. `user_contact_handles` holds the peppered digest of a handle only for a
//      user who turned on "Let friends find me", computed server-side from the
//      same `contactHandleDigest` of their own account email.
// An unpeppered SHA-256 of a phone number or email is NOT secret — the input
// space is small enough to guess — which is why step 2 keeps nothing.

/** Most digests one `POST /v1/friends/contacts/match` accepts. */
export const CONTACT_MATCH_MAX_HASHES = 500;
/** Match calls a user may make per hour (fixed window, `rate_limits`). */
export const CONTACT_MATCH_CALLS_PER_HOUR = 5;

export const CONTACT_HANDLE_KINDS = ["email", "phone"] as const;
export type ContactHandleKind = (typeof CONTACT_HANDLE_KINDS)[number];

/**
 * Which handle kinds the client uploads for matching. Phone is left out until
 * phone numbers can be verified (OTP): nobody can opt a phone number in to be
 * found, so a phone digest could never match and sending it would be data
 * sent for nothing.
 */
export const CONTACT_MATCH_KINDS: readonly ContactHandleKind[] = ["email"];

/** A contact digest on the wire: 64 lowercase hex chars. */
export const CONTACT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Funnel events for the spike (`POST /v1/telemetry/contacts`, stored in
 * `contact_discovery_events`). `matched` is written by the server itself on
 * every match call; the client sends the rest.
 */
export const CONTACT_CLIENT_EVENTS = [
  /** The consent screen was shown (once per screen visit). */
  "prompt_shown",
  /** OS answer after our consent screen: limited access (iOS 18+). */
  "limited_granted",
  /** OS answer: full access. */
  "full_granted",
  /** OS answer: denied (or previously denied). */
  "denied",
  /** The user opened the limited-access picker to share more contacts. */
  "picker_opened",
  /** One-tap Add on an "On HighScore" row (a directed request was sent). */
  "add",
  /** An invite composer was opened for a "Not yet on HighScore" row. */
  "invite_opened",
  /** The invite was sent (SMS composer reported `sent`, or the share sheet completed). */
  "invite_sent",
] as const;
export type ContactClientEvent = (typeof CONTACT_CLIENT_EVENTS)[number];

export type ContactRelationship = "friend" | "outgoing" | "incoming" | "none";

/** One discoverable HighScore user that matched a submitted digest. */
export interface ContactMatch {
  userId: string;
  displayName: string | null;
  /** The submitted digests this user matched, so the client can name the contact. */
  digests: string[];
  relationship: ContactRelationship;
}

/** `POST /v1/friends/contacts/match` */
export interface ContactMatchResponse {
  matches: ContactMatch[];
}

/** `GET` / `PUT /v1/users/me/discoverability` */
export interface DiscoverabilityResponse {
  email: {
    enabled: boolean;
    /** The account email being offered, or null when the account has none. */
    address: string | null;
    /** An Apple Hide My Email relay address: nobody has it in their contacts. */
    isRelay: boolean;
  };
  phone: {
    /** Always false until phone verification ships. */
    enabled: false;
    available: false;
  };
}

// --- Normalization ----------------------------------------------------------

/** Lowercased, trimmed email, or null when it isn't one. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Apple "Hide My Email" relay addresses are per-app: no contact card has one. */
export function isAppleRelayEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@privaterelay.appleid.com");
}

/**
 * Country calling codes for the regions a device is likely to report. A
 * number written without `+` from a region not listed here is dropped rather
 * than guessed at.
 */
const CALLING_CODES: Record<string, string> = {
  US: "1",
  CA: "1",
  GB: "44",
  IE: "353",
  AU: "61",
  NZ: "64",
  DE: "49",
  FR: "33",
  ES: "34",
  NL: "31",
  BE: "32",
  CH: "41",
  AT: "43",
  SE: "46",
  NO: "47",
  DK: "45",
  FI: "358",
  PT: "351",
  IL: "972",
  IN: "91",
  JP: "81",
  BR: "55",
  MX: "52",
  ZA: "27",
  SG: "65",
};

/**
 * E.164 (`+<country><number>`) for a phone number as typed in a contact card,
 * or null when it can't be read unambiguously. `region` is the device's ISO
 * country (e.g. "US"), used only for numbers written without a country code.
 * Deliberately small (no libphonenumber): a number this misreads simply
 * doesn't match.
 */
export function normalizePhoneE164(raw: string, region: string | null): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Extensions ("x123", ";ext=", ",") are not part of the number.
  const main = trimmed.split(/(?:[;,]|\bext\.?|\bx)/i)[0] ?? "";
  const digits = main.replace(/\D/g, "");
  let e164: string | null = null;
  if (main.trimStart().startsWith("+")) {
    e164 = `+${digits}`;
  } else if (digits.startsWith("00")) {
    e164 = `+${digits.slice(2)}`;
  } else {
    const cc = region ? CALLING_CODES[region.toUpperCase()] : undefined;
    if (!cc) return null;
    if (cc === "1") {
      if (digits.startsWith("011")) e164 = `+${digits.slice(3)}`;
      else if (digits.length === 10) e164 = `+1${digits}`;
      else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
      else return null;
    } else {
      // Drop one national trunk prefix ("07700 …" in the UK).
      const national = digits.startsWith("0") ? digits.slice(1) : digits;
      e164 = `+${cc}${national}`;
    }
  }
  const total = e164.length - 1;
  if (total < 8 || total > 15 || e164.startsWith("+0")) return null;
  return e164;
}

// --- Hashing ----------------------------------------------------------------

const DIGEST_DOMAIN = "highscore-contact-v1";

/**
 * The digest of one normalized handle, as sent by the client and as the
 * server computes it for a user's own handle before peppering.
 */
export function contactHandleDigest(kind: ContactHandleKind, normalized: string): string {
  return sha256Hex(`${DIGEST_DOMAIN}|${kind}|${normalized}`);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return Uint8Array.from(out);
}

/**
 * SHA-256 of a string's UTF-8 bytes, as lowercase hex. Pure JS so the client
 * needs no crypto native module; `contacts.test.ts` pins it to Node's
 * `crypto.createHash("sha256")`.
 */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] as number;
      const b = w[i - 2] as number;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] as number) + (w[i] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] as number) + (next[i] as number)) >>> 0;
  }
  let hex = "";
  for (const word of h) hex += word.toString(16).padStart(8, "0");
  return hex;
}
