import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbUser, letterboxdWatchlistFilms, userFlags, users } from "../../db/schema.js";
import { deleteUserAccount } from "../../lib/accountDeletion.js";
import { isAdminUser, userLabel } from "../../lib/admin.js";
import { notifyDiscord } from "../../lib/discord.js";
import { logger } from "../../lib/logger.js";
import { notifyLetterboxdConnected, notifySessionsRevoked } from "../../lib/opsNotifications.js";
import {
  loadRevocableIdentities,
  type ProviderRevocationResult,
  revokeProviderTokens,
} from "../../lib/providerRevocation.js";
import { clearRefreshCredential } from "../../lib/refreshCookie.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { revokeAllSessions } from "../../lib/sessionRevocation.js";
import { LetterboxdScrapeError } from "../../lib/sources/letterboxdList.js";
import {
  InvalidLetterboxdUsernameError,
  normalizeLetterboxdUsername,
  syncUserWatchlist,
} from "../../lib/sources/letterboxdWatchlist.js";
import { userFlagKeySchema, userFlagValueSchema } from "../../lib/userFlags.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const userRoutes = new Hono();
export const publicUserRoutes = new Hono();
userRoutes.use("*", requireAuth);

// Display names: stripped, 1–40 chars, no leading/trailing whitespace,
// no embedded newlines. Permissive on character set — emoji + non-Latin OK.
export const displayNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "display name required").max(40, "display name too long"))
  .refine((s) => !/[\r\n]/.test(s), "display name must be a single line");

// Profile pictures are stored inline as base64 `data:` URLs (same approach as
// list cover photos — there's no object store yet). The picker crops to a
// square and downscales, so the payload stays well under this cap in practice.
const AVATAR_MAX_CHARS = 1_500_000;
export const avatarUrlSchema = z
  .string()
  .max(AVATAR_MAX_CHARS, "profile picture too large")
  .refine(
    (s) => /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s),
    "profile picture must be a base64 data URL",
  );

const avatarDataUrlRe = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const uuidSchema = z.string().uuid();

function avatarContentType(kind: string): string {
  return kind === "jpg" ? "image/jpeg" : `image/${kind}`;
}

// Both fields are optional; the client sends only what changed. `avatarUrl: null`
// clears the picture. `.refine` rejects an empty body so a no-op PATCH can't
// silently bump `updated_at`.
const patchMeSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    avatarUrl: avatarUrlSchema.nullable().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.avatarUrl !== undefined, {
    message: "nothing to update",
  });

const connectLetterboxdSchema = z.object({
  username: z.string().min(1, "username required").max(2048, "username too long"),
});

function toUserShape(u: DbUser) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    isAdmin: isAdminUser(u),
    avatarUrl: u.avatarUrl,
    letterboxdUsername: u.letterboxdUsername,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function toImpersonationTargetShape(u: {
  id: string;
  email: string | null;
  displayName: string | null;
}) {
  if (!u.email) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
  };
}

publicUserRoutes.get("/:id/avatar", async (c) => {
  const parsed = uuidSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return err(c, "NOT_FOUND", "profile picture not found");

  const db = getDb();
  const [user] = await db
    .select({ avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, parsed.data))
    .limit(1);
  const match = user?.avatarUrl?.match(avatarDataUrlRe);
  if (!match) return err(c, "NOT_FOUND", "profile picture not found");

  const [, kind, payload] = match;
  const body = Buffer.from(payload ?? "", "base64");
  return new Response(body, {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Type": avatarContentType(kind ?? "png"),
    },
  });
});

userRoutes.get("/impersonation-targets", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const [admin] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!admin) return err(c, "UNAUTHORIZED", "invalid or expired session");
  if (!isAdminUser(admin)) return err(c, "FORBIDDEN", "admin access required");

  const rows = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(isNotNull(users.email), ne(users.id, admin.id)))
    .orderBy(sql`lower(${users.email})`)
    .limit(200);

  return ok(c, { users: rows.map(toImpersonationTargetShape).filter((u) => u !== null) });
});

userRoutes.patch("/me", async (c) => {
  const parsed = await parseJsonBody(c, patchMeSchema);
  if (!parsed.ok) return parsed.response;
  const userId = c.get("userId");
  const db = getDb();
  const patch: Partial<Pick<DbUser, "displayName" | "avatarUrl">> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (parsed.data.displayName !== undefined) patch.displayName = parsed.data.displayName;
  if (parsed.data.avatarUrl !== undefined) patch.avatarUrl = parsed.data.avatarUrl;
  const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "user not found");
  return ok(c, { user: toUserShape(updated) });
});

// --- User flags (durable per-user key/value state: dismissals, adoption markers) ---

/**
 * All of the caller's flags in one map. Small by construction (bounded keys,
 * ≤2KB values, one row per key), so no pagination.
 */
userRoutes.get("/me/flags", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const rows = await db
    .select({ key: userFlags.key, value: userFlags.value })
    .from(userFlags)
    .where(eq(userFlags.userId, userId));
  const flags: Record<string, unknown> = {};
  for (const row of rows) flags[row.key] = row.value;
  return ok(c, { flags });
});

const putFlagSchema = z.object({ value: userFlagValueSchema });

/** Set (upsert) one flag. Client-owned flags only carry client-authored state;
 * server-authored markers (e.g. `games.share-extension-score`) are also
 * writable here by their owner — harmless, since flags are self-scoped and
 * only ever gate that same user's UI. */
userRoutes.put(
  "/me/flags/:key",
  rateLimit({
    family: "v1.users.flags",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const key = userFlagKeySchema.safeParse(c.req.param("key"));
    if (!key.success) return err(c, "VALIDATION", "invalid flag key");
    const parsed = await parseJsonBody(c, putFlagSchema);
    if (!parsed.ok) return parsed.response;

    const userId = c.get("userId");
    const db = getDb();
    const now = new Date();
    await db
      .insert(userFlags)
      .values({ userId, key: key.data, value: parsed.data.value, updatedAt: now })
      .onConflictDoUpdate({
        target: [userFlags.userId, userFlags.key],
        set: { value: parsed.data.value, updatedAt: now },
      });
    return ok(c, { key: key.data, value: parsed.data.value });
  },
);

// --- Letterboxd connection (account-level, reused by every match list) ---

/**
 * Connect (or change) the account-level Letterboxd username. Accepts a bare
 * username, "@name", or any letterboxd.com profile/watchlist URL. Validates
 * the watchlist is publicly reachable by running the initial watchlist sync
 * inline — a private/missing watchlist rejects with a stable code instead of
 * silently storing a username that can never sync.
 */
userRoutes.put(
  "/me/letterboxd",
  rateLimit({
    family: "v1.users.letterboxd-connect",
    limit: 5,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, connectLetterboxdSchema);
    if (!parsed.ok) return parsed.response;
    const userId = c.get("userId");

    let username: string;
    try {
      username = normalizeLetterboxdUsername(parsed.data.username);
    } catch (e) {
      if (e instanceof InvalidLetterboxdUsernameError) {
        return err(c, "VALIDATION", "invalid Letterboxd username", {
          code: "INVALID_LETTERBOXD_USERNAME",
        });
      }
      throw e;
    }

    const db = getDb();
    let filmCount = 0;
    try {
      const result = await syncUserWatchlist({ userId, username, db });
      filmCount = result.filmCount;
    } catch (e) {
      if (e instanceof LetterboxdScrapeError) {
        const code =
          e.status === 404
            ? "LETTERBOXD_USER_NOT_FOUND"
            : e.status === 403
              ? "LETTERBOXD_WATCHLIST_PRIVATE"
              : "LETTERBOXD_FETCH_FAILED";
        logger.warn("letterboxd connect failed", { userId, username, status: e.status });
        return err(c, "VALIDATION", "could not read that Letterboxd watchlist", { code });
      }
      throw e;
    }

    const [updated] = await db
      .update(users)
      .set({ letterboxdUsername: username, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) return err(c, "NOT_FOUND", "user not found");
    await notifyLetterboxdConnected(userId, username, filmCount);
    return ok(c, { user: toUserShape(updated), filmCount });
  },
);

/** Disconnect Letterboxd — clears the username and the cached watchlist. */
userRoutes.delete("/me/letterboxd", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const [updated] = await db
    .update(users)
    .set({ letterboxdUsername: null, letterboxdSyncedAt: null, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) return err(c, "NOT_FOUND", "user not found");
  await db.delete(letterboxdWatchlistFilms).where(eq(letterboxdWatchlistFilms.userId, userId));
  return ok(c, { user: toUserShape(updated) });
});

// Sign out of every device — bumps `sessions_invalidated_at` so every existing
// session token for this user is rejected on its next request. The user has
// to sign in again to mint a fresh token.
/**
 * Permanent account deletion (App Store Review Guideline 5.1.1(v)).
 *
 * Self-only: the subject is always the authenticated `userId`; there is no
 * target parameter, so no caller can delete anyone else. Blocked while an admin
 * is impersonating — the session's real owner is not the account on screen, and
 * an impersonated delete would destroy a user's data under someone else's hand.
 *
 * Order matters. Identity rows are read first (they hold the sealed Apple
 * refresh token), then the transactional delete runs, then provider revocation
 * is attempted. A revocation failure cannot leave the user stuck: their data is
 * already gone and the response reports the real per-provider outcome. See
 * lib/providerRevocation.ts for the full failure semantics.
 *
 * Because Workshop and HighScore share one `users` row, this deletes the
 * account across both apps — the client says so before asking to confirm.
 */
userRoutes.delete("/me", async (c) => {
  if (c.get("impersonatorUserId")) {
    return err(c, "FORBIDDEN", "stop impersonating before deleting an account", {
      code: "IMPERSONATION_ACTIVE",
    });
  }

  const userId = c.get("userId");
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return err(c, "NOT_FOUND", "user not found");

  const identities = await loadRevocableIdentities(userId);
  const counts = await deleteUserAccount(userId);
  if (counts.users === 0) return err(c, "NOT_FOUND", "user not found");

  logger.warn("account deleted", { userId, ...counts });
  clearRefreshCredential(c);

  const providerRevocations: ProviderRevocationResult[] = await revokeProviderTokens(identities, {
    userId,
  });
  await notifyDiscord(
    `:bomb: account deleted — ${userLabel(user)} (${describeRevocations(providerRevocations)})`,
    { kind: "account_deleted" },
  );

  c.header("Cache-Control", "no-store");
  return ok(c, { ok: true, deletedUserId: userId, providerRevocations });
});

function describeRevocations(results: ProviderRevocationResult[]): string {
  if (results.length === 0) return "no linked providers";
  return results.map((r) => `${r.provider}: ${r.status}`).join(", ");
}

userRoutes.delete("/me/sessions", async (c) => {
  const userId = c.get("userId");
  await revokeAllSessions(userId);
  await notifySessionsRevoked(userId);
  return ok(c, { ok: true });
});
