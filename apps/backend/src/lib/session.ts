import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getConfig } from "./config.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

// `iat` is optional for backwards compatibility with tokens minted before
// server-side revocation existed. The auth middleware treats a missing `iat`
// as `0`, so any `DELETE /v1/users/me/sessions` call invalidates them too.
const sessionPayloadSchema = z.object({
  userId: z.string(),
  exp: z.number(),
  iat: z.number().optional(),
});

type SessionPayload = z.infer<typeof sessionPayloadSchema>;

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function signSession(userId: string): string {
  const { sessionSecret } = getConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    userId,
    exp: now + SESSION_TTL_SECONDS,
    iat: now,
  };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac("sha256", sessionSecret).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export function verifySession(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const { sessionSecret } = getConfig();
  const expected = createHmac("sha256", sessionSecret).update(payloadB64).digest();
  let provided: Buffer;
  try {
    provided = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  const result = sessionPayloadSchema.safeParse(parsed);
  if (!result.success) return null;
  const payload = result.data;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
