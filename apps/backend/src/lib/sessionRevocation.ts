import { and, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { authSessions, users } from "../db/schema.js";

interface ManagedSessionCheck {
  sessionId: string;
  subjectUserId: string;
  /**
   * Refresh version the access token was minted with (absent on tokens minted
   * before the claim existed). When present and newer than the row's
   * `last_used_refresh_version`, the check records it — proof the rotated
   * credential reached the client, which `rotateDeviceSession` consults before
   * treating an older token as replay.
   */
  sessionVersion?: number | undefined;
}

export interface SessionCheck {
  /** The session must be rejected (401). */
  revoked: boolean;
  /**
   * The checked user has no `display_name` yet. Read from the same `users`
   * row as the revocation cutoff, so the display-name lock in `requireAuth`
   * costs no extra query. Always false when `revoked`.
   */
  displayNameMissing: boolean;
}

/**
 * Server-side session revocation: every token is checked against the user's
 * `sessions_invalidated_at` cutoff. Managed access tokens additionally require
 * an active device-session row whose current principal matches the token.
 *
 * Returns `true` when the session must be rejected. A non-existent user is
 * treated as revoked — a deleted user's tokens shouldn't continue to work.
 * Tokens minted before this feature shipped have no `iat`; passing `0` for
 * `iat` will revoke them whenever `sessions_invalidated_at` is set.
 */
export async function isSessionRevoked(
  userId: string,
  iatSeconds: number,
  managed?: ManagedSessionCheck,
): Promise<boolean> {
  return (await checkSession(userId, iatSeconds, managed)).revoked;
}

const REVOKED: SessionCheck = { revoked: true, displayNameMissing: false };

/** `isSessionRevoked` plus whether that user still has to pick a display name. */
export async function checkSession(
  userId: string,
  iatSeconds: number,
  managed?: ManagedSessionCheck,
): Promise<SessionCheck> {
  const db = getDb();
  // First DB touch on every authenticated request — wrapping it in the retry
  // both rides out a Neon cold-start here and warms the pooled connection for
  // the rest of the request, so the route's own queries don't re-race the wake.
  const [row] = await withDbRetry(
    () =>
      db
        .select({
          sessionsInvalidatedAt: users.sessionsInvalidatedAt,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    { label: "isSessionRevoked" },
  );

  if (!row) return REVOKED;
  if (
    row.sessionsInvalidatedAt &&
    iatSeconds < Math.floor(row.sessionsInvalidatedAt.getTime() / 1000)
  ) {
    return REVOKED;
  }
  const live: SessionCheck = { revoked: false, displayNameMissing: row.displayName == null };
  if (!managed) return live;

  const [session] = await db
    .select({
      impersonatedUserId: authSessions.impersonatedUserId,
      idleExpiresAt: authSessions.idleExpiresAt,
      absoluteExpiresAt: authSessions.absoluteExpiresAt,
      revokedAt: authSessions.revokedAt,
      lastUsedRefreshVersion: authSessions.lastUsedRefreshVersion,
    })
    .from(authSessions)
    .where(and(eq(authSessions.id, managed.sessionId), eq(authSessions.userId, userId)))
    .limit(1);
  if (!session || session.revokedAt) return REVOKED;
  const now = Date.now();
  if (session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
    return REVOKED;
  }
  const expectedSubject = session.impersonatedUserId ?? userId;
  if (expectedSubject !== managed.subjectUserId) return REVOKED;

  // One UPDATE per rotation per device (the first request after each refresh),
  // not per request — the guard below keeps the hot path read-only.
  if (
    managed.sessionVersion !== undefined &&
    (session.lastUsedRefreshVersion ?? 0) < managed.sessionVersion
  ) {
    await recordAccessTokenUse(managed.sessionId, managed.sessionVersion);
  }
  return live;
}

/** Mark `version`'s access token as seen (monotonic; never moves backwards). */
async function recordAccessTokenUse(sessionId: string, version: number): Promise<void> {
  await getDb()
    .update(authSessions)
    .set({ lastUsedRefreshVersion: version })
    .where(
      and(
        eq(authSessions.id, sessionId),
        or(
          isNull(authSessions.lastUsedRefreshVersion),
          lt(authSessions.lastUsedRefreshVersion, version),
        ),
      ),
    );
}

/**
 * Bumps the legacy cutoff and revokes every owned managed session atomically.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ sessionsInvalidatedAt: now }).where(eq(users.id, userId));
    await tx.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.userId, userId));
  });
}
