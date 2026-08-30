// Identity-provider token lifecycle for account deletion.
//
// Apple requires that an app offering Sign in with Apple revoke the user's
// tokens when they delete their account (App Store Review Guideline 5.1.1(v)).
// Revocation needs a token, and the only way to hold one is to exchange the
// one-time `authorizationCode` the client gets at sign-in for a refresh token
// and keep it sealed at rest — that's what `rememberAppleAuthorizationCode`
// does, on a best-effort basis, on every Apple sign-in.
//
// ## Failure semantics (deliberate, and tested)
//
// Deleting the account is the user's action; talking to Apple is ours. So the
// data deletion always runs, and revocation is attempted *after* it commits,
// with a hard timeout. Every outcome is reported honestly in the response
// rather than assumed:
//
//   revoked        — Apple accepted the revoke call.
//   nothing_to_revoke — no sealed refresh token for that identity (signed in
//                    before this shipped, or the client sent no auth code), so
//                    there is nothing we *can* revoke. Deleting the identity
//                    row already stops the app from using it; the user can also
//                    remove the app under Settings → Apple Account → Sign in
//                    with Apple.
//   unavailable    — the server-to-server Apple credentials aren't configured
//                    in this environment.
//   failed         — the call was made and errored (network, 4xx/5xx). Logged
//                    with the user id so it can be retried by hand; the account
//                    is still gone.
//
// Google is `nothing_to_revoke` by construction: we authenticate Google users
// with an id_token only and never request offline access, so no refresh token
// exists on our side to revoke. Users manage app access at
// myaccount.google.com/permissions.

import type { ProviderRevocationResult, ProviderRevocationStatus } from "@workshop/shared";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { userIdentities } from "../db/schema.js";
import { logger } from "./logger.js";
import {
  AppleTokenError,
  appleTokenApiConfigured,
  exchangeAppleAuthorizationCode,
  revokeAppleToken,
} from "./oauth/appleTokens.js";
import { open, PROVIDER_REFRESH_TOKEN_PURPOSE, seal } from "./secretBox.js";

export type { ProviderRevocationResult };

export interface RevocableIdentity {
  provider: "apple" | "google";
  providerSub: string;
  providerClientId: string | null;
  refreshTokenEncrypted: string | null;
}

/**
 * Read the identity rows for a user *before* deleting them, so the tokens are
 * still available for the post-commit revoke pass.
 */
export async function loadRevocableIdentities(userId: string): Promise<RevocableIdentity[]> {
  const db = getDb();
  return db
    .select({
      provider: userIdentities.provider,
      providerSub: userIdentities.providerSub,
      providerClientId: userIdentities.providerClientId,
      refreshTokenEncrypted: userIdentities.refreshTokenEncrypted,
    })
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId));
}

/**
 * Exchange an Apple sign-in authorization code for a refresh token and seal it
 * onto the identity row. Best effort by design: a failure here must never break
 * sign-in, it only means account deletion will report `nothing_to_revoke`.
 */
export async function rememberAppleAuthorizationCode(input: {
  providerSub: string;
  clientId: string;
  authorizationCode: string;
}): Promise<void> {
  if (!appleTokenApiConfigured()) return;
  try {
    const refreshToken = await exchangeAppleAuthorizationCode({
      code: input.authorizationCode,
      clientId: input.clientId,
    });
    if (!refreshToken) return;
    await getDb()
      .update(userIdentities)
      .set({
        providerClientId: input.clientId,
        refreshTokenEncrypted: seal(PROVIDER_REFRESH_TOKEN_PURPOSE, refreshToken),
        refreshTokenUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(userIdentities.provider, "apple"),
          eq(userIdentities.providerSub, input.providerSub),
        ),
      );
  } catch (error) {
    // Apple rejects a code that's already been redeemed, which happens
    // routinely (e.g. a retried request). Never surface it to the user.
    logger.warn("apple authorization code exchange failed", {
      error,
      configured: appleTokenApiConfigured(),
    });
  }
}

/**
 * Attempt provider-side revocation for a deleted account's identities. Never
 * throws: every identity resolves to an honest status.
 */
export async function revokeProviderTokens(
  identities: RevocableIdentity[],
  context: { userId: string },
): Promise<ProviderRevocationResult[]> {
  const results: ProviderRevocationResult[] = [];
  for (const identity of identities) {
    results.push({
      provider: identity.provider,
      status: await revokeOne(identity, context),
    });
  }
  return results;
}

async function revokeOne(
  identity: RevocableIdentity,
  context: { userId: string },
): Promise<ProviderRevocationStatus> {
  if (identity.provider !== "apple") return "nothing_to_revoke";
  const token = open(PROVIDER_REFRESH_TOKEN_PURPOSE, identity.refreshTokenEncrypted);
  if (!token) return "nothing_to_revoke";
  if (!appleTokenApiConfigured()) return "unavailable";
  const clientId = identity.providerClientId;
  if (!clientId) return "unavailable";
  try {
    await revokeAppleToken({ token, clientId, tokenTypeHint: "refresh_token" });
    return "revoked";
  } catch (error) {
    logger.error("apple token revocation failed after account deletion", {
      error,
      userId: context.userId,
      clientId,
      appleError: error instanceof AppleTokenError ? error.message : undefined,
    });
    return "failed";
  }
}
