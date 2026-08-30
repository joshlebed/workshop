// Sign in with Apple server-to-server token endpoints.
//
// Sign-in itself only needs the identity token (verified in `apple.ts`), but
// App Store Review Guideline 5.1.1(v) requires that deleting an account also
// revokes the Apple tokens it was built on. Revocation needs a token to revoke,
// and the only way to get one is to exchange the one-time `authorizationCode`
// the client receives at sign-in for a refresh token.
//
// Both endpoints authenticate with a `client_secret` that is an ES256 JWT we
// sign ourselves with the Sign in with Apple key (.p8) — issuer = team id,
// audience = https://appleid.apple.com, subject = the client id. The client id
// is per-platform (iOS bundle id vs. web Services ID), and a secret minted for
// one client is rejected for another, so every call takes the client id the
// original credential was issued to (we persist it on `user_identities`).
//
// Everything here is optional infrastructure: with `APPLE_TEAM_ID` /
// `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY` unset, `appleTokenApiConfigured()` is
// false and callers skip the exchange/revoke entirely rather than pretending
// it happened.

import { importPKCS8, SignJWT } from "jose";
import { getConfig } from "../config.js";

const APPLE_AUDIENCE = "https://appleid.apple.com";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
/** Apple caps client-secret lifetime at 6 months; minutes is plenty per call. */
const CLIENT_SECRET_TTL = "5m";
/** Keep provider calls well inside the 15s Lambda budget. */
const DEFAULT_TIMEOUT_MS = 5_000;

export class AppleTokenError extends Error {
  constructor(
    message: string,
    public readonly appleCause?: unknown,
  ) {
    super(message);
    this.name = "AppleTokenError";
  }
}

/** True when the three server-to-server credentials are all present. */
export function appleTokenApiConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.appleTeamId && c.appleKeyId && c.applePrivateKey);
}

/**
 * Mint the ES256 `client_secret` JWT for one Apple client id. Throws
 * `AppleTokenError` if the credentials are missing or the .p8 doesn't parse.
 */
export async function createAppleClientSecret(clientId: string): Promise<string> {
  const { appleTeamId, appleKeyId, applePrivateKey } = getConfig();
  if (!appleTeamId || !appleKeyId || !applePrivateKey) {
    throw new AppleTokenError("apple token api not configured");
  }
  let key: CryptoKey;
  try {
    key = (await importPKCS8(applePrivateKey, "ES256")) as CryptoKey;
  } catch (error) {
    throw new AppleTokenError("apple private key could not be parsed", error);
  }
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: appleKeyId })
    .setIssuer(appleTeamId)
    .setAudience(APPLE_AUDIENCE)
    .setSubject(clientId)
    .setIssuedAt()
    .setExpirationTime(CLIENT_SECRET_TTL)
    .sign(key);
}

async function postForm(
  url: string,
  params: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });
  } catch (error) {
    throw new AppleTokenError("apple token request failed", error);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exchange a sign-in `authorizationCode` for Apple's refresh token. Returns
 * null when Apple accepts the request but issues no refresh token (it only
 * does so for a fresh, unused code).
 */
export async function exchangeAppleAuthorizationCode(input: {
  code: string;
  clientId: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const clientSecret = await createAppleClientSecret(input.clientId);
  const response = await postForm(
    APPLE_TOKEN_URL,
    {
      client_id: input.clientId,
      client_secret: clientSecret,
      code: input.code,
      grant_type: "authorization_code",
    },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new AppleTokenError(`apple token exchange returned ${response.status}`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  const refreshToken = (body as { refresh_token?: unknown }).refresh_token;
  return typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null;
}

/**
 * Revoke an Apple token. Apple answers 200 with an empty body on success;
 * anything else throws so the caller can record the failure honestly.
 */
export async function revokeAppleToken(input: {
  token: string;
  clientId: string;
  tokenTypeHint?: "refresh_token" | "access_token";
  timeoutMs?: number;
}): Promise<void> {
  const clientSecret = await createAppleClientSecret(input.clientId);
  const response = await postForm(
    APPLE_REVOKE_URL,
    {
      client_id: input.clientId,
      client_secret: clientSecret,
      token: input.token,
      token_type_hint: input.tokenTypeHint ?? "refresh_token",
    },
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new AppleTokenError(`apple revoke returned ${response.status}`);
  }
}
