import type { JWTVerifyGetKey } from "jose";
import { googleAudiences } from "../config.js";
import {
  getRemoteJwks,
  OAuthVerifyError,
  type VerifiedClaims,
  verifyIdentityToken,
} from "./jwks.js";

// Google's OIDC discovery lists both forms; both are valid issuer values on
// real id_tokens, so we accept either.
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

interface GoogleVerifyInput {
  idToken: string;
}

interface GoogleVerifyDeps {
  jwks?: JWTVerifyGetKey;
  audiences?: string[];
}

export async function verifyGoogleIdentityToken(
  input: GoogleVerifyInput,
  deps: GoogleVerifyDeps = {},
): Promise<VerifiedClaims> {
  const audience = deps.audiences ?? googleAudiences();
  if (audience.length === 0) {
    throw new OAuthVerifyError("google audiences not configured");
  }
  const jwks = deps.jwks ?? getRemoteJwks(GOOGLE_JWKS_URL);
  return verifyIdentityToken(input.idToken, jwks, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });
}
