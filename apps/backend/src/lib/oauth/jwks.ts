import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";

export interface VerifiedClaims extends JWTPayload {
  sub: string;
  aud: string | string[];
  iss: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  nonce?: string;
}

interface VerifyOptions {
  issuer: string | string[];
  audience: string[];
  /** Optional: assert the token's nonce claim matches this value. */
  nonce?: string;
}

export class OAuthVerifyError extends Error {
  constructor(
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "OAuthVerifyError";
  }
}

/**
 * Verify an OIDC identity token against a JWKS. Returns normalized claims
 * with the required fields narrowed.
 */
export async function verifyIdentityToken(
  token: string,
  jwks: JWTVerifyGetKey,
  opts: VerifyOptions,
): Promise<VerifiedClaims> {
  if (opts.audience.length === 0) {
    throw new OAuthVerifyError("no audiences configured");
  }
  let result: Awaited<ReturnType<typeof jwtVerify>>;
  try {
    result = await jwtVerify(token, jwks, {
      issuer: opts.issuer,
      audience: opts.audience,
    });
  } catch (e) {
    throw new OAuthVerifyError("token verification failed", e);
  }
  const claims = result.payload as VerifiedClaims;
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new OAuthVerifyError("token missing sub");
  }
  if (opts.nonce !== undefined && claims.nonce !== opts.nonce) {
    throw new OAuthVerifyError("nonce mismatch");
  }
  return claims;
}

/**
 * Memoize a JWKS fetcher per URL so we don't hold one open per request.
 * `jose`'s createRemoteJWKSet already caches keys in-memory and refreshes on
 * `kid` miss with a cooldown; we just need to keep the same instance alive.
 */
const jwksCache = new Map<string, JWTVerifyGetKey>();

export function getRemoteJwks(url: string): JWTVerifyGetKey {
  let cached = jwksCache.get(url);
  if (!cached) {
    cached = createRemoteJWKSet(new URL(url));
    jwksCache.set(url, cached);
  }
  return cached;
}
