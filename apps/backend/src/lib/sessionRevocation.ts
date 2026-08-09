import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { authSessions, users } from "../db/schema.js";

interface ManagedSessionCheck {
  sessionId: string;
  subjectUserId: string;
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
  const db = getDb();
  // First DB touch on every authenticated request — wrapping it in the retry
  // both rides out a Neon cold-start here and warms the pooled connection for
  // the rest of the request, so the route's own queries don't re-race the wake.
  const [row] = await withDbRetry(
    () =>
      db
        .select({ sessionsInvalidatedAt: users.sessionsInvalidatedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    { label: "isSessionRevoked" },
  );

  if (!row) return true;
  if (
    row.sessionsInvalidatedAt &&
    iatSeconds < Math.floor(row.sessionsInvalidatedAt.getTime() / 1000)
  ) {
    return true;
  }
  if (!managed) return false;

  const [session] = await db
    .select({
      impersonatedUserId: authSessions.impersonatedUserId,
      idleExpiresAt: authSessions.idleExpiresAt,
      absoluteExpiresAt: authSessions.absoluteExpiresAt,
      revokedAt: authSessions.revokedAt,
    })
    .from(authSessions)
    .where(and(eq(authSessions.id, managed.sessionId), eq(authSessions.userId, userId)))
    .limit(1);
  if (!session || session.revokedAt) return true;
  const now = Date.now();
  if (session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
    return true;
  }
  const expectedSubject = session.impersonatedUserId ?? userId;
  return expectedSubject !== managed.subjectUserId;
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
