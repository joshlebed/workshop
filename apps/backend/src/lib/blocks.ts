// User-block helpers (App Store Review Guideline 1.2). `user_blocks` is
// one-directional (`blocker_id` → `blocked_id`); every check here is
// symmetric because a block in either direction must keep the pair apart.

import { and, eq, or } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { userBlocks } from "../db/schema.js";

/** True when either user has blocked the other. */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const [row] = await getDb()
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Every user id `userId` must not see or be seen by: people they blocked plus
 * people who blocked them. Used to scrub the mutuals suggestions, which walk
 * the graph past the direct friend edge a block already removed.
 */
export async function blockedIdsFor(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
    .from(userBlocks)
    .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}
