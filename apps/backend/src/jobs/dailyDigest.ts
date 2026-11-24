// `{ "job": "daily-digest" }`: one scannable #workshop-admin message a morning.
//
// Routine growth and activity used to ping one event at a time (~30 messages a
// day, most of them game adds in bursts). The digest counts the same events
// from their own tables, so there is no event store to keep in step. Only
// aggregates leave the database: one row, a few hundred bytes of Neon transfer.
//
// The window is the previous calendar day in US Eastern, computed by Postgres so
// a 23- or 25-hour DST day has no gap or overlap. The message is sent last and
// nothing throws after it: Lambda retries a failed async invocation, and a retry
// that follows a delivered digest would post it twice.

import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { notifyDiscord } from "../lib/discord.js";
import { logger } from "../lib/logger.js";
import { type DbClient, executeRows } from "../lib/sql.js";

const DIGEST_TIMEZONE = "America/New_York";

export interface DailyDigest {
  /** Start of the digest day, as an instant. */
  windowStart: Date;
  windowEnd: Date;
  signups: number;
  /** Of `signups`, how many have posted a score. */
  signupsScored: number;
  /** Signups in the 30 days ending at `windowEnd`. */
  recentSignups: number;
  /** Of `recentSignups`, how many have never posted a score. */
  recentNeverScored: number;
  /** Distinct HighScore users who took an action (same actions as `actionRows`). */
  activeUsers: number;
  /** Mean daily active users over the seven days ending at `windowEnd`. */
  activeUsersWeekAvg: number;
  scores: number;
  gamesAdded: number;
  friendships: number;
  firstScores: number;
  firstFriends: number;
  listsCreated: number;
  listsArchived: number;
  listsJoined: number;
  letterboxdConnected: number;
}

type DigestRow = Record<
  Exclude<keyof DailyDigest, "windowStart" | "windowEnd">,
  number | string
> & {
  windowStart: Date | string;
  windowEnd: Date | string;
};

export async function loadDailyDigest(db: DbClient, now: Date): Promise<DailyDigest> {
  const tz = DIGEST_TIMEZONE;
  const nowIso = now.toISOString();
  const [row] = await executeRows<DigestRow>(
    db,
    sql`
    WITH bounds AS (
      SELECT
        (date_trunc('day', ${nowIso}::timestamptz AT TIME ZONE ${tz}) - interval '1 day') AT TIME ZONE ${tz} AS start_at,
        date_trunc('day', ${nowIso}::timestamptz AT TIME ZONE ${tz}) AT TIME ZONE ${tz} AS end_at,
        (date_trunc('day', ${nowIso}::timestamptz AT TIME ZONE ${tz}) - interval '7 days') AT TIME ZONE ${tz} AS week_start_at
    ),
    actions AS (
      SELECT user_id, created_at AS at FROM game_scores, bounds
        WHERE created_at >= week_start_at AND created_at < end_at
      UNION ALL
      SELECT user_id, added_at FROM user_games, bounds
        WHERE added_at >= week_start_at AND added_at < end_at
      UNION ALL
      SELECT reactor_user_id, created_at FROM game_score_reactions, bounds
        WHERE created_at >= week_start_at AND created_at < end_at
      UNION ALL
      SELECT sender_id, created_at FROM game_nudges, bounds
        WHERE created_at >= week_start_at AND created_at < end_at
      UNION ALL
      SELECT user_low, created_at FROM friendships, bounds
        WHERE created_at >= week_start_at AND created_at < end_at
      UNION ALL
      SELECT user_high, created_at FROM friendships, bounds
        WHERE created_at >= week_start_at AND created_at < end_at
    ),
    active AS (
      SELECT
        count(DISTINCT user_id) FILTER (WHERE at >= start_at)::int AS active_users,
        count(DISTINCT (user_id, (at AT TIME ZONE ${tz})::date))::int AS active_user_days
      FROM actions, bounds
      GROUP BY start_at
    ),
    cohort AS (
      SELECT
        u.created_at >= b.start_at AS in_window,
        EXISTS (SELECT 1 FROM game_scores s WHERE s.user_id = u.id) AS scored
      FROM users u, bounds b
      WHERE u.created_at >= b.end_at - interval '30 days' AND u.created_at < b.end_at
    ),
    funnel AS (
      SELECT
        count(*) FILTER (WHERE in_window)::int AS signups,
        count(*) FILTER (WHERE in_window AND scored)::int AS signups_scored,
        count(*)::int AS recent_signups,
        count(*) FILTER (WHERE NOT scored)::int AS recent_never_scored
      FROM cohort
    )
    SELECT
      b.start_at AS "windowStart",
      b.end_at AS "windowEnd",
      f.signups AS "signups",
      f.signups_scored AS "signupsScored",
      f.recent_signups AS "recentSignups",
      f.recent_never_scored AS "recentNeverScored",
      coalesce((SELECT active_users FROM active), 0) AS "activeUsers",
      coalesce((SELECT active_user_days FROM active), 0) / 7.0 AS "activeUsersWeekAvg",
      (SELECT count(*)::int FROM game_scores
        WHERE created_at >= b.start_at AND created_at < b.end_at) AS "scores",
      (SELECT count(*)::int FROM user_games
        WHERE added_at >= b.start_at AND added_at < b.end_at) AS "gamesAdded",
      (SELECT count(*)::int FROM friendships
        WHERE created_at >= b.start_at AND created_at < b.end_at) AS "friendships",
      (SELECT count(*)::int FROM (
        SELECT user_id FROM game_scores GROUP BY user_id
        HAVING min(created_at) >= b.start_at AND min(created_at) < b.end_at
      ) first_scores) AS "firstScores",
      (SELECT count(*)::int FROM users u
        CROSS JOIN LATERAL (
          SELECT min(fr.created_at) AS first_at FROM friendships fr
          WHERE fr.user_low = u.id OR fr.user_high = u.id
        ) ff
        WHERE u.referred_by_user_id IS NULL
          AND u.created_at >= b.start_at - interval '24 hours' AND u.created_at < b.end_at
          AND ff.first_at >= b.start_at AND ff.first_at < b.end_at
          AND ff.first_at < u.created_at + interval '24 hours') AS "firstFriends",
      (SELECT count(*)::int FROM lists
        WHERE created_at >= b.start_at AND created_at < b.end_at) AS "listsCreated",
      (SELECT count(*)::int FROM lists
        WHERE archived_at >= b.start_at AND archived_at < b.end_at) AS "listsArchived",
      (SELECT count(*)::int FROM list_members
        WHERE role <> 'owner' AND joined_at >= b.start_at AND joined_at < b.end_at) AS "listsJoined",
      (SELECT count(*)::int FROM users
        WHERE letterboxd_connected_at >= b.start_at AND letterboxd_connected_at < b.end_at) AS "letterboxdConnected"
    FROM bounds b, funnel f
  `,
  );
  if (!row) throw new Error("daily digest query returned no row");
  const n = (value: number | string) => Number(value);
  return {
    windowStart: new Date(row.windowStart),
    windowEnd: new Date(row.windowEnd),
    signups: n(row.signups),
    signupsScored: n(row.signupsScored),
    recentSignups: n(row.recentSignups),
    recentNeverScored: n(row.recentNeverScored),
    activeUsers: n(row.activeUsers),
    activeUsersWeekAvg: n(row.activeUsersWeekAvg),
    scores: n(row.scores),
    gamesAdded: n(row.gamesAdded),
    friendships: n(row.friendships),
    firstScores: n(row.firstScores),
    firstFriends: n(row.firstFriends),
    listsCreated: n(row.listsCreated),
    listsArchived: n(row.listsArchived),
    listsJoined: n(row.listsJoined),
    letterboxdConnected: n(row.letterboxdConnected),
  };
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** The non-zero parts joined with ` · `, or null when all are zero. */
function nonZero(parts: [number, string][]): string | null {
  const shown = parts.filter(([count]) => count > 0).map(([, text]) => text);
  return shown.length > 0 ? shown.join(" · ") : null;
}

/** Pure, so the exact wording is unit-tested. Holds only counts, never a name. */
export function buildDailyDigestMessage(d: DailyDigest): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: DIGEST_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d.windowStart);
  const neverPct =
    d.recentSignups > 0 ? ` (${Math.round((d.recentNeverScored / d.recentSignups) * 100)}%)` : "";
  const social = nonZero([
    [d.gamesAdded, plural(d.gamesAdded, "game added", "games added")],
    [d.friendships, plural(d.friendships, "friendship")],
    [d.firstScores, plural(d.firstScores, "first score")],
    [
      d.firstFriends,
      plural(d.firstFriends, "first friend after signup", "first friends after signup"),
    ],
  ]);
  const listActivity = nonZero([
    [d.listsCreated, `${d.listsCreated} new`],
    [d.listsArchived, `${d.listsArchived} archived`],
    [d.listsJoined, `${d.listsJoined} joined`],
    [d.letterboxdConnected, `${d.letterboxdConnected} Letterboxd connected`],
  ]);
  return [
    `📊 **Daily digest** · ${day}`,
    `**Signups:** ${d.signups} → ${d.signupsScored} posted a score`,
    `**Never scored:** ${d.recentNeverScored} of ${d.recentSignups} signups in the last 30 days${neverPct}`,
    `**HighScore:** ${d.activeUsers} active (7-day avg ${d.activeUsersWeekAvg.toFixed(1)}) · ${plural(d.scores, "score")}`,
    social ? `**Activity:** ${social}` : null,
    listActivity ? `**Lists:** ${listActivity}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

interface DailyDigestJobArgs {
  now?: Date;
  db?: DbClient;
  notify?: (content: string) => Promise<boolean>;
}

export async function runDailyDigestJob(
  args: DailyDigestJobArgs = {},
): Promise<{ delivered: boolean }> {
  const now = args.now ?? new Date();
  const db = args.db ?? getDb();
  const notify =
    args.notify ??
    ((content: string) => notifyDiscord(content, { kind: "daily_digest", withClient: false }));
  const digest = await withDbRetry(() => loadDailyDigest(db, now));
  const delivered = await notify(buildDailyDigestMessage(digest));
  // Counts only: this line is the digest's record if Discord dropped it.
  logger.info("daily digest", { ...digest, delivered });
  if (!delivered) logger.error("job failed", { job: "daily-digest", reason: "not delivered" });
  return { delivered };
}
