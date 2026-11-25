// Friend (pair) streaks — spike #10. The rule is the pure `computeFriendStreak`
// in `@workshop/shared/games`: consecutive calendar days on which both players
// posted at least one score (any game), live through yesterday like the
// per-game flame. This module only reads the days.
//
// The read is shaped for Neon's transfer allowance: Postgres intersects the two
// players' score-days and keeps only the most recent run of shared days per
// friend (gaps-and-islands), so a friend with a 5-day streak costs 5 short
// strings, not 120 days of rows. The pure function then decides liveness on
// that run, so the SQL never re-states the rule.

import {
  computeFriendStreak,
  FRIEND_STREAK_LOOKBACK_DAYS,
  type FriendStreak,
  STREAK_MIN_DAYS,
  shiftPeriodKey,
} from "@workshop/shared/games";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { friendStreakKeepalivePosts } from "../db/schema.js";
import { friendsOf } from "./friends.js";
import { logger } from "./logger.js";
import { type DbClient, executeRows } from "./sql.js";

const NO_STREAK: FriendStreak = { days: 0, viewerPostedToday: false, friendPostedToday: false };

/**
 * Each friend's pair streak with the viewer as of `today` (the viewer's local
 * date). One query; every id in `friendIds` gets an entry (0 when none).
 */
export async function loadFriendStreaks(
  viewerId: string,
  friendIds: string[],
  today: string,
  db: DbClient = getDb(),
): Promise<Map<string, FriendStreak>> {
  const result = new Map<string, FriendStreak>();
  if (friendIds.length === 0) return result;
  const since = shiftPeriodKey(today, -FRIEND_STREAK_LOOKBACK_DAYS);
  const ids = sql.join(
    [viewerId, ...friendIds].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await executeRows<{
    friendId: string;
    runDays: string[] | null;
    postedToday: boolean;
    viewerPostedToday: boolean;
  }>(
    db,
    sql`
    WITH days AS (
      SELECT DISTINCT user_id, period_key
      FROM game_scores
      WHERE user_id IN (${ids}) AND period_key >= ${since} AND period_key <= ${today}
        AND period_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ),
    shared AS (
      SELECT f.user_id AS friend_id, f.period_key::date AS d
      FROM days f
      JOIN days v ON v.period_key = f.period_key AND v.user_id = ${viewerId}::uuid
      WHERE f.user_id <> ${viewerId}::uuid
    ),
    islands AS (
      SELECT friend_id, d,
        d - (row_number() OVER (PARTITION BY friend_id ORDER BY d))::int AS grp
      FROM shared
    ),
    latest AS (
      SELECT friend_id, array_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d) AS run_days
      FROM islands i
      WHERE grp = (SELECT max(grp) FROM islands j WHERE j.friend_id = i.friend_id)
      GROUP BY friend_id
    )
    SELECT u.id AS "friendId", l.run_days AS "runDays",
      EXISTS (SELECT 1 FROM days t WHERE t.user_id = u.id AND t.period_key = ${today}) AS "postedToday",
      EXISTS (SELECT 1 FROM days t WHERE t.user_id = ${viewerId}::uuid AND t.period_key = ${today}) AS "viewerPostedToday"
    FROM unnest(ARRAY[${sql.join(
      friendIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}]) AS u(id)
    LEFT JOIN latest l ON l.friend_id = u.id
  `,
  );
  for (const row of rows) {
    const run = row.runDays ?? [];
    // The run holds only shared days, so feed it as both sides' days; the
    // today flags come from the full day set, not the run.
    const days = computeFriendStreak(run, run, today).days;
    result.set(row.friendId, {
      days,
      viewerPostedToday: row.viewerPostedToday,
      friendPostedToday: row.postedToday,
    });
  }
  for (const id of friendIds) if (!result.has(id)) result.set(id, NO_STREAK);
  return result;
}

/**
 * After a score post: if it was the poster's first score of `periodKey` and a
 * pair streak of ≥ `STREAK_MIN_DAYS` reached yesterday without them — the
 * state in which the home shows "You and Sam: 5 days — post to keep it" — write
 * one `friend_streak_keepalive_posts` row per such friend. Best-effort: never
 * throws, so it can't fail the post.
 */
export async function recordKeepalivePost(userId: string, periodKey: string): Promise<number> {
  try {
    const db = getDb();
    const [mine] = await executeRows<{ n: number }>(
      db,
      sql`SELECT count(*)::int AS n FROM game_scores WHERE user_id = ${userId}::uuid AND period_key = ${periodKey}`,
    );
    if (Number(mine?.n ?? 0) !== 1) return 0;
    const friendIds = await friendsOf(userId);
    if (friendIds.length === 0) return 0;
    // As of the day before: the streak the poster saw before this post.
    const yesterday = shiftPeriodKey(periodKey, -1);
    const before = await loadFriendStreaks(userId, friendIds, yesterday, db);
    const saved: { userId: string; friendId: string; periodKey: string; streakDays: number }[] = [];
    for (const [friendId, streak] of before) {
      // Both posted yesterday, so the run ends yesterday; seen from
      // `periodKey` it is live and waiting on the poster (`friendStreakAtRisk`
      // "viewer" or "both").
      const reachedYesterday = streak.viewerPostedToday && streak.friendPostedToday;
      if (reachedYesterday && streak.days >= STREAK_MIN_DAYS) {
        saved.push({ userId, friendId, periodKey, streakDays: streak.days });
      }
    }
    if (saved.length === 0) return 0;
    await db.insert(friendStreakKeepalivePosts).values(saved).onConflictDoNothing();
    logger.info("friend_streak_keepalive_post", {
      user_id: userId,
      period_key: periodKey,
      friends: saved.length,
      longest: Math.max(...saved.map((s) => s.streakDays)),
    });
    return saved.length;
  } catch (error) {
    logger.error("friend streak keepalive record failed", { error, user_id: userId });
    return 0;
  }
}
