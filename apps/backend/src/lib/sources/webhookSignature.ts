// Signature verification for push-driven sources (§3.6 of the redesign).
// Each source kind that publishes webhooks declares its signature scheme in
// `WEBHOOK_VERIFIERS`. The generic inbound route looks up the source row by
// `webhook_slug`, dispatches to the right verifier, and calls the source's
// sync impl if verification passes.
//
// No source kind ships with a webhook today (Spotify + Letterboxd are both
// pull-based). This scaffolding sits in place so the first push-bearing
// kind (RSS via WebSub, Github releases, etc.) lands on top of a tested
// signature primitive rather than building it as part of the same PR.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface WebhookRequest {
  /** Raw HTTP request body — the exact bytes the upstream signed. */
  rawBody: Buffer;
  /** Lowercased header map; signature schemes pick which header(s) to read. */
  headers: Readonly<Record<string, string | undefined>>;
}

export interface WebhookVerifier {
  /** Stable identifier shown in logs / errors. */
  scheme: string;
  /**
   * Returns true when the request's signature header authenticates the body
   * against a per-source shared secret. Constant-time comparison.
   */
  verify: (req: WebhookRequest, sharedSecret: string) => boolean;
}

/**
 * Generic HMAC-SHA-256 verifier. Reads the hex digest from `signatureHeader`
 * and compares against `HMAC(sharedSecret, rawBody)`. Many providers use
 * this shape — GitHub's `X-Hub-Signature-256: sha256=...`, Discord's webhook
 * signatures, etc. Specific providers may prefer their own verifier (e.g.
 * Stripe's tolerance-window timestamp), in which case add a sibling entry
 * to `WEBHOOK_VERIFIERS`.
 */
export function hmacSha256Verifier(args: {
  scheme: string;
  signatureHeader: string;
  /** Optional prefix to strip from the header (e.g. "sha256=" for GitHub). */
  headerPrefix?: string;
}): WebhookVerifier {
  return {
    scheme: args.scheme,
    verify: (req, sharedSecret) => {
      const headerValue = req.headers[args.signatureHeader.toLowerCase()];
      if (typeof headerValue !== "string" || headerValue.length === 0) return false;
      let trimmed: string;
      if (args.headerPrefix) {
        // Strict: the configured prefix is part of the auth contract.
        if (!headerValue.startsWith(args.headerPrefix)) return false;
        trimmed = headerValue.slice(args.headerPrefix.length);
      } else {
        trimmed = headerValue;
      }
      const expected = createHmac("sha256", sharedSecret).update(req.rawBody).digest("hex");
      if (trimmed.length !== expected.length) return false;
      // Constant-time comparison guards against timing oracles.
      return timingSafeEqual(Buffer.from(trimmed, "hex"), Buffer.from(expected, "hex"));
    },
  };
}

/**
 * Per-kind webhook verifier registry. Empty today — populate when the first
 * push-bearing source kind lands. Keys must match a `SourceKind`.
 */
export const WEBHOOK_VERIFIERS: Readonly<Record<string, WebhookVerifier>> = {};

export class UnknownWebhookKindError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(`no webhook verifier registered for kind: ${kind}`);
    this.name = "UnknownWebhookKindError";
    this.kind = kind;
  }
}

export function getWebhookVerifier(kind: string): WebhookVerifier {
  const verifier = WEBHOOK_VERIFIERS[kind];
  if (!verifier) throw new UnknownWebhookKindError(kind);
  return verifier;
}

/**
 * Generate a fresh webhook slug. Used at `list_sources` insert time when
 * the source kind opts into push-driven sync. The slug is the inbound URL
 * path segment — `POST /v1/sources/webhooks/<slug>` — so it must be hard
 * to guess. 128 bits of entropy, base32-ish alphabet (no punctuation that
 * would need URL escaping).
 */
export function generateWebhookSlug(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(20);
  let out = "";
  for (const byte of bytes) {
    out += alphabet[byte % alphabet.length];
  }
  return out;
}
