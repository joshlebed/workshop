import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { users } from "../db/schema.js";

/**
 * Server-side session revocation: any session whose `iat` predates the user's
 * `sessions_invalidated_at` is rejected. Bumped by the
 * `DELETE /v1/users/me/sessions` endpoint to sign a user out of every device.
 *
 * Returns `true` when the session must be rejected. A non-existent user is
 * treated as revoked — a deleted user's tokens shouldn't continue to work.
 * Tokens minted before this feature shipped have no `iat`; passing `0` for
 * `iat` will revoke them whenever `sessions_invalidated_at` is set.
 */
export async function isSessionRevoked(userId: string, iatSeconds: number): Promise<boolean> {
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
  if (!row.sessionsInvalidatedAt) return false;
  return iatSeconds < Math.floor(row.sessionsInvalidatedAt.getTime() / 1000);
}

/**
 * Bumps the cutoff to `now()` so every existing session for this user is
 * rejected by `isSessionRevoked` on its next request.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  const db = getDb();
  await db.update(users).set({ sessionsInvalidatedAt: new Date() }).where(eq(users.id, userId));
}
