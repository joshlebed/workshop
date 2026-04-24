import type { JWTVerifyGetKey } from "jose";
import { appleAudiences } from "../config.js";
import {
  getRemoteJwks,
  OAuthVerifyError,
  type VerifiedClaims,
  verifyIdentityToken,
} from "./jwks.js";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

interface AppleVerifyInput {
  identityToken: string;
  /** Required when the client supplied one (mobile + web Apple SDKs both pass it). */
  nonce?: string;
}

interface AppleVerifyDeps {
  /** Override the JWKS resolver in tests. */
  jwks?: JWTVerifyGetKey;
  /** Override the configured audiences in tests. */
  audiences?: string[];
}

export async function verifyAppleIdentityToken(
  input: AppleVerifyInput,
  deps: AppleVerifyDeps = {},
): Promise<VerifiedClaims> {
  const audience = deps.audiences ?? appleAudiences();
  if (audience.length === 0) {
    throw new OAuthVerifyError("apple audiences not configured");
  }
  const jwks = deps.jwks ?? getRemoteJwks(APPLE_JWKS_URL);
  const opts: { issuer: string; audience: string[]; nonce?: string } = {
    issuer: APPLE_ISSUER,
    audience,
  };
  if (input.nonce !== undefined) opts.nonce = input.nonce;
  return verifyIdentityToken(input.identityToken, jwks, opts);
}
