import type { AuthProvider } from "@workshop/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbUser, users } from "../../db/schema.js";
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
    authProvider: u.authProvider as AuthProvider,
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

// Thrown when a sign-in's (provider, sub) doesn't match an existing user but
// its email matches a user under a *different* provider. Without this guard
// `upsertUser` would silently create a second user row with the same email,
// stranding the original account's data (lists, items, history) behind the
// old provider — exactly what happened to joshlebed@gmail.com on 2026-05-18.
export class EmailProviderConflictError extends Error {
  constructor(
    public readonly existingProvider: AuthProvider,
    public readonly attemptedProvider: AuthProvider,
    public readonly email: string,
  ) {
    super(`email ${email} already registered via ${existingProvider}`);
    this.name = "EmailProviderConflictError";
  }
}

async function upsertUser({ provider, sub, email, displayName }: UpsertInput): Promise<DbUser> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.authProvider, provider), eq(users.providerSub, sub)))
    .limit(1);

  if (existing) {
    // Backfill email/displayName only if we now have a value and didn't before —
    // never overwrite something the user already set.
    const patch: Partial<DbUser> = {};
    if (email && !existing.email) patch.email = email;
    if (displayName && !existing.displayName) patch.displayName = displayName;
    if (Object.keys(patch).length === 0) return existing;
    const [updated] = await db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  // No (provider, sub) match — about to create a new user. First make sure the
  // email isn't already in use by another provider, or we'd silently fork the
  // account in two. Match is case-insensitive: providers don't normalise case
  // and our schema stores raw email.
  if (email) {
    const [emailMatch] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    if (emailMatch && emailMatch.authProvider !== provider) {
      throw new EmailProviderConflictError(
        emailMatch.authProvider as AuthProvider,
        provider,
        email,
      );
    }
  }

  const [created] = await db
    .insert(users)
    .values({
      authProvider: provider,
      providerSub: sub,
      email,
      displayName,
    })
    .returning();
  if (!created) throw new Error("user insert returned no row");
  const label = created.displayName ?? created.email ?? created.id;
  await notifyDiscord(`:wave: new signup — ${label} via ${provider}`);
  return created;
}

function providerLabel(p: AuthProvider): string {
  return p === "apple" ? "Apple" : p === "google" ? "Google" : p;
}

function emailConflictMessage(e: EmailProviderConflictError): string {
  return `This email is already registered with ${providerLabel(e.existingProvider)}. Please sign in with ${providerLabel(e.existingProvider)} instead.`;
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

  let user: DbUser;
  try {
    user = await upsertUser({
      provider: "apple",
      sub: claims.sub,
      email,
      displayName: fullName ?? null,
    });
  } catch (e) {
    if (e instanceof EmailProviderConflictError) {
      logger.info("apple sign-in blocked by email collision", {
        email: e.email,
        existingProvider: e.existingProvider,
      });
      return err(c, "CONFLICT", emailConflictMessage(e));
    }
    throw e;
  }

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

  let user: DbUser;
  try {
    user = await upsertUser({
      provider: "google",
      sub: claims.sub,
      email,
      displayName,
    });
  } catch (e) {
    if (e instanceof EmailProviderConflictError) {
      logger.info("google sign-in blocked by email collision", {
        email: e.email,
        existingProvider: e.existingProvider,
      });
      return err(c, "CONFLICT", emailConflictMessage(e));
    }
    throw e;
  }

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
authRoutes.post("/dev", async (c) => {
  if (!getConfig().devAuthEnabled) {
    return err(c, "NOT_FOUND", "not found");
  }
  const parsed = await parseJsonBody(c, devBodySchema);
  if (!parsed.ok) return parsed.response;
  const { email, displayName } = parsed.data;
  const sub = `dev:${email}`;

  let user: DbUser;
  try {
    user = await upsertUser({
      provider: "google",
      sub,
      email,
      displayName: displayName ?? null,
    });
  } catch (e) {
    if (e instanceof EmailProviderConflictError) {
      return err(c, "CONFLICT", emailConflictMessage(e));
    }
    throw e;
  }

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
