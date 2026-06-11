// Friend graph helpers (spec §3.4/§3.6, G2a). The `friendships` table stores
// one row per unordered pair, canonically `user_low < user_high` — this
// module is the only writer, so the invariant lives here, not in a CHECK.

import { and, eq, or } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { friendships } from "../db/schema.js";

/** Order a pair canonically (`user_low < user_high`). Throws on self-pairs. */
export function canonicalPair(a: string, b: string): { userLow: string; userHigh: string } {
  if (a === b) throw new Error("cannot friend yourself");
  return a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };
}

/**
 * All friend ids of `userId` — one query over both columns. The OR is
 * indexed on both sides: the PK covers `user_low`, `friendships_high_idx`
 * covers `user_high`.
 */
export async function friendsOf(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ userLow: friendships.userLow, userHigh: friendships.userHigh })
    .from(friendships)
    .where(or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)));
  return rows.map((r) => (r.userLow === userId ? r.userHigh : r.userLow));
}

/**
 * Idempotent symmetric insert — always stores the canonical orientation, so
 * `addFriendship(a, b)` and `addFriendship(b, a)` land on the same row.
 * Returns `true` when a new edge was created, `false` when the pair was
 * already friends (lets callers ping ops only on genuinely-new friendships).
 */
export async function addFriendship(a: string, b: string): Promise<boolean> {
  const pair = canonicalPair(a, b);
  const inserted = await getDb()
    .insert(friendships)
    .values(pair)
    .onConflictDoNothing()
    .returning({ userLow: friendships.userLow });
  return inserted.length > 0;
}

/** Remove the edge between two users (no-op when it doesn't exist). */
export async function removeFriendship(a: string, b: string): Promise<void> {
  if (a === b) return;
  const pair = canonicalPair(a, b);
  await getDb()
    .delete(friendships)
    .where(and(eq(friendships.userLow, pair.userLow), eq(friendships.userHigh, pair.userHigh)));
}
