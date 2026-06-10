import type { AuthProvider } from "@workshop/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbUser, userIdentities, users } from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { notifyDiscord } from "../../lib/discord.js";
import { logger } from "../../lib/logger.js";
import { verifyAppleIdentityToken } from "../../lib/oauth/apple.js";
import { verifyGoogleIdentityToken } from "../../lib/oauth/google.js";
import { OAuthVerifyError, type VerifiedClaims } from "../../lib/oauth/jwks.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { signSession } from "../../lib/session.js";
import { requireAuth } from "../../middleware/auth.js";

export const authRoutes = new Hono();

const appleBodySchema = z.object({
  identityToken: z.string().min(1),
  nonce: z.string().min(1).optional(),
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(60).optional(),
});

const googleBodySchema = z.object({
  idToken: z.string().min(1),
});

function toUserShape(u: DbUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

interface UpsertInput {
  provider: AuthProvider;
  sub: string;
  email: string | null;
  displayName: string | null;
}

// Resolve a sign-in to a single canonical user, linking accounts by email
// when a verified provider hits an existing email for the first time. The
// resolution order is:
//   1. (provider, sub) hit in `user_identities` → return that user.
//   2. email hit in `users` → attach a new identity row → return that user
//      (this is the "I previously signed in with Apple, now signing in with
//      Google using the same Gmail address" case).
//   3. otherwise → create user + first identity.
// Email match is case-insensitive; providers don't normalise case and our
// schema stores raw email.
async function upsertIdentity({
  provider,
  sub,
  email,
  displayName,
}: UpsertInput): Promise<{ user: DbUser; createdUser: boolean }> {
  const db = getDb();

  const [identity] = await db
    .select({ user: users })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId))
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.providerSub, sub)))
    .limit(1);

  if (identity) {
    const existing = identity.user;
    const patch: Partial<DbUser> = {};
    if (email && !existing.email) patch.email = email;
    if (displayName && !existing.displayName) patch.displayName = displayName;
    if (Object.keys(patch).length === 0) return { user: existing, createdUser: false };
    const [updated] = await db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, existing.id))
      .returning();
    return { user: updated ?? existing, createdUser: false };
  }

  if (email) {
    const [emailMatch] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    if (emailMatch) {
      await db.insert(userIdentities).values({ provider, providerSub: sub, userId: emailMatch.id });
      const patch: Partial<DbUser> = {};
      if (displayName && !emailMatch.displayName) patch.displayName = displayName;
      if (Object.keys(patch).length === 0) return { user: emailMatch, createdUser: false };
      const [updated] = await db
        .update(users)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(users.id, emailMatch.id))
        .returning();
      return { user: updated ?? emailMatch, createdUser: false };
    }
  }

  const [created] = await db.insert(users).values({ email, displayName }).returning();
  if (!created) throw new Error("user insert returned no row");
  await db.insert(userIdentities).values({ provider, providerSub: sub, userId: created.id });
  return { user: created, createdUser: true };
}

// Build the operator-channel message for a sign-in. A genuinely new user gets
// the high-signal ":wave: new signup" copy; a returning user — including one
// linking a second provider to a known email (`createdUser: false`) — gets a
// quieter "signed in" line. Label falls back display name → email → id. Pure so
// it's unit-tested without a DB or Discord (see auth.test.ts).
export function buildSignInNotification(
  user: Pick<DbUser, "id" | "email" | "displayName">,
  provider: AuthProvider,
  createdUser: boolean,
): { content: string; kind: string } {
  const label = user.displayName ?? user.email ?? user.id;
  return createdUser
    ? { content: `:wave: new signup — ${label} via ${provider}`, kind: "signup" }
    : { content: `:bust_in_silhouette: signed in — ${label} via ${provider}`, kind: "signin" };
}

// Ping the operator channel on every sign-in (new or returning). The auth event
// is logged independently of Discord so a missing admin message stays
// traceable: the log line proves the sign-in happened and the notify was
// attempted even if the Discord POST later fails (grep `discord notify` for the
// delivery outcome). Discord failures swallow inside notifyDiscord, so this can
// never break the sign-in.
async function notifySignIn(
  user: DbUser,
  provider: AuthProvider,
  createdUser: boolean,
): Promise<void> {
  const { content, kind } = buildSignInNotification(user, provider, createdUser);
  logger.info(createdUser ? "new signup" : "sign-in", {
    userId: user.id,
    provider,
    label: user.displayName ?? user.email ?? user.id,
  });
  await notifyDiscord(content, { kind });
}

authRoutes.post("/apple", async (c) => {
  const parsed = await parseJsonBody(c, appleBodySchema);
  if (!parsed.ok) return parsed.response;
  const { identityToken, nonce, email: clientEmail, fullName } = parsed.data;

  let claims: VerifiedClaims;
  try {
    const verifyInput: { identityToken: string; nonce?: string } = { identityToken };
    if (nonce !== undefined) verifyInput.nonce = nonce;
    claims = await verifyAppleIdentityToken(verifyInput);
  } catch (e) {
    if (e instanceof OAuthVerifyError) {
      logger.info("apple token rejected", { reason: e.message });
      return err(c, "UNAUTHORIZED", "invalid apple identity token");
    }
    throw e;
  }

  // Apple includes `email` in the JWT for both real addresses and Hide-My-Email
  // relays. The client also forwards email/name explicitly because Apple only
  // emits the human-readable name on first sign-in and not in the JWT itself.
  const tokenEmail = typeof claims.email === "string" ? claims.email : null;
  const email = clientEmail ?? tokenEmail;

  const { user, createdUser } = await upsertIdentity({
    provider: "apple",
    sub: claims.sub,
    email,
    displayName: fullName ?? null,
  });
  await notifySignIn(user, "apple", createdUser);

  const token = signSession(user.id);
  return ok(c, {
    user: toUserShape(user),
    token,
    needsDisplayName: !user.displayName,
  });
});

authRoutes.post("/google", async (c) => {
  const parsed = await parseJsonBody(c, googleBodySchema);
  if (!parsed.ok) return parsed.response;

  let claims: VerifiedClaims;
  try {
    claims = await verifyGoogleIdentityToken({ idToken: parsed.data.idToken });
  } catch (e) {
    if (e instanceof OAuthVerifyError) {
      logger.info("google token rejected", { reason: e.message });
      return err(c, "UNAUTHORIZED", "invalid google identity token");
    }
    throw e;
  }

  const email = typeof claims.email === "string" ? claims.email : null;
  const displayName = typeof claims.name === "string" ? claims.name : null;

  const { user, createdUser } = await upsertIdentity({
    provider: "google",
    sub: claims.sub,
    email,
    displayName,
  });
  await notifySignIn(user, "google", createdUser);

  const token = signSession(user.id);
  return ok(c, {
    user: toUserShape(user),
    token,
    needsDisplayName: !user.displayName,
  });
});

const devBodySchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(40).nullable().optional(),
});

// Dev-only sign-in for E2E tests. Gated on DEV_AUTH_ENABLED=1. Never enable in prod.
// Uses a stable synthetic `provider_sub` derived from the email so repeat calls
// resolve to the same user.
//
// Deliberately does NOT call notifySignIn: this is the sandbox/E2E auto-sign-in
// path (the web app re-hits it on every boot), and pinging the operator channel
// on each preview load / test run would be pure noise. It no-ops in prod anyway
// (route is disabled) and locally (webhook unset), so a ping here only ever
// fires in a sandbox with the webhook set — exactly where it's least wanted.
authRoutes.post("/dev", async (c) => {
  if (!getConfig().devAuthEnabled) {
    return err(c, "NOT_FOUND", "not found");
  }
  const parsed = await parseJsonBody(c, devBodySchema);
  if (!parsed.ok) return parsed.response;
  const { email, displayName } = parsed.data;

  // The dev route reuses the apple provider+synthetic-sub pair so it survives
  // the same path-2 email-link rules as a real OAuth sign-in. On a Neon
  // sandbox branch forked from prod this resolves to the real user record
  // (e.g. joshlebed@gmail.com → existing apple-linked account), so the agent
  // and previews see the same data the human sees.
  const { user } = await upsertIdentity({
    provider: "apple",
    sub: `dev:${email}`,
    email,
    displayName: displayName ?? null,
  });

  const token = signSession(user.id);
  logger.info("dev sign-in issued", { userId: user.id, email });
  return ok(c, {
    user: toUserShape(user),
    token,
    needsDisplayName: !user.displayName,
  });
});

authRoutes.post("/signout", requireAuth, (c) => ok(c, { ok: true }));

authRoutes.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return err(c, "NOT_FOUND", "user not found");
  return ok(c, { user: toUserShape(u) });
});
