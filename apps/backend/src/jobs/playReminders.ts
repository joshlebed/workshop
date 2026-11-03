import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { gameScores, notificationPrefs, pushTokens } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { sendExpoPushMessages } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";
import { type DbClient, executeRows } from "../lib/sql.js";

const FALLBACK_REMINDER_TIMEZONE = "America/New_York";
const FALLBACK_REMINDER_HOUR = 11;

const REMINDER_DEDUP_HOURS = 20;

interface CandidateTokenRow {
  userId: string;
  timezone: string;
  expoPushToken: string;
  playedToday: boolean;
}

interface PlayReminderJobResult {
  candidates: number;
  skippedPlayed: number;
  sent: number;
  pruned: number;
}

/**
 * The latest active installation is the account's canonical timezone. This
 * keeps one reminder schedule per user even if old devices remain registered.
 */
export async function reminderTimezoneForUser(
  userId: string,
  db: DbClient = getDb(),
): Promise<string> {
  const [token] = await db
    .select({ timezone: pushTokens.timezone })
    .from(pushTokens)
    .where(eq(pushTokens.userId, userId))
    .orderBy(desc(pushTokens.lastSeenAt), desc(pushTokens.createdAt), pushTokens.expoPushToken)
    .limit(1);
  return token?.timezone ?? FALLBACK_REMINDER_TIMEZONE;
}

/**
 * Suggest the local hour containing the most score submissions. Fewer than
 * five historical scores is too little signal, so the product default wins.
 */
export async function suggestPlayReminderHour(
  userId: string,
  timezone: string,
  db: DbClient = getDb(),
): Promise<number> {
  const rows = await executeRows<{ hour: number | string; totalCount: number | string }>(
    db,
    sql`
      SELECT
        EXTRACT(HOUR FROM ${gameScores.createdAt} AT TIME ZONE ${timezone})::int AS hour,
        SUM(COUNT(*)) OVER ()::int AS "totalCount"
      FROM ${gameScores}
      WHERE ${gameScores.userId} = ${userId}
      GROUP BY 1
      ORDER BY COUNT(*) DESC, hour ASC
      LIMIT 1
    `,
  );
  const peak = rows[0];
  if (!peak || Number(peak.totalCount) < 5) return FALLBACK_REMINDER_HOUR;
  return Number(peak.hour);
}

async function selectCandidateTokens(db: DbClient, now: Date): Promise<CandidateTokenRow[]> {
  return executeRows<CandidateTokenRow>(
    db,
    sql`
      WITH canonical_timezones AS (
        SELECT DISTINCT ON (${pushTokens.userId})
          ${pushTokens.userId} AS user_id,
          ${pushTokens.timezone} AS timezone
        FROM ${pushTokens}
        ORDER BY
          ${pushTokens.userId},
          ${pushTokens.lastSeenAt} DESC,
          ${pushTokens.createdAt} DESC,
          ${pushTokens.expoPushToken} ASC
      ), candidate_users AS (
        SELECT
          ${notificationPrefs.userId} AS user_id,
          canonical.timezone,
          EXISTS (
            SELECT 1
            FROM ${gameScores} scores
            WHERE scores.user_id = ${notificationPrefs.userId}
              AND (scores.created_at AT TIME ZONE canonical.timezone)::date =
                (${now.toISOString()}::timestamptz AT TIME ZONE canonical.timezone)::date
          ) AS played_today
        FROM ${notificationPrefs}
        INNER JOIN canonical_timezones canonical ON canonical.user_id = ${notificationPrefs.userId}
        WHERE ${notificationPrefs.playReminderEnabled} = true
          AND (
            ${notificationPrefs.lastRemindedAt} IS NULL
            OR ${notificationPrefs.lastRemindedAt} <=
              ${now.toISOString()}::timestamptz - (${REMINDER_DEDUP_HOURS} * INTERVAL '1 hour')
          )
          -- A fall-back day repeats hour 1, so the last-reminded guard above
          -- deduplicates it. A spring-forward hour that never occurs is
          -- intentionally skipped in v1.
          AND ${notificationPrefs.playReminderHour} = EXTRACT(
            HOUR FROM ${now.toISOString()}::timestamptz AT TIME ZONE canonical.timezone
          )::int
      )
      SELECT
        candidate_users.user_id AS "userId",
        candidate_users.timezone,
        ${pushTokens.expoPushToken} AS "expoPushToken",
        candidate_users.played_today AS "playedToday"
      FROM candidate_users
      INNER JOIN ${pushTokens} ON ${pushTokens.userId} = candidate_users.user_id
      ORDER BY candidate_users.user_id, ${pushTokens.expoPushToken}
    `,
  );
}

/** Hourly scheduled job invoked by the Lambda's `{ "job": "play-reminders" }` branch. */
export async function runPlayReminderJob(
  args: { db?: DbClient; now?: Date; fetchFn?: typeof fetch } = {},
): Promise<PlayReminderJobResult> {
  const config = getConfig();
  const empty: PlayReminderJobResult = {
    candidates: 0,
    skippedPlayed: 0,
    sent: 0,
    pruned: 0,
  };
  if (!config.isLocal && !config.gamesEnabled) {
    logger.info("play reminder job complete", {
      candidates: 0,
      skipped_played: 0,
      sent: 0,
      pruned: 0,
    });
    return empty;
  }

  const db = args.db ?? getDb();
  const now = args.now ?? new Date();
  const fetchFn = args.fetchFn ?? fetch;
  const rows = await withDbRetry(() => selectCandidateTokens(db, now), {
    label: "play-reminders",
  });

  const candidates = new Set(rows.map((row) => row.userId)).size;
  const skippedPlayed = new Set(rows.filter((row) => row.playedToday).map((row) => row.userId))
    .size;
  const sendable = rows.filter((row) => !row.playedToday);
  if (sendable.length === 0) {
    logger.info("play reminder job complete", {
      candidates,
      skipped_played: skippedPlayed,
      sent: 0,
      pruned: 0,
    });
    return { candidates, skippedPlayed, sent: 0, pruned: 0 };
  }

  const delivery = await sendExpoPushMessages(
    sendable.map((candidate) => ({
      to: candidate.expoPushToken,
      title: "Time to play",
      body: "Your daily games are waiting",
      data: { url: "highscore:///" },
    })),
    {
      db,
      fetchFn,
      onChunkError: (error, chunkIndex, tokenCount) =>
        logger.error("play reminder push chunk failed", {
          error,
          chunk_index: chunkIndex,
          token_count: tokenCount,
        }),
    },
  );

  // "Sent" for the job = Expo answered for the message (an error ticket still
  // counts as an attempt); a user is reminded once any of their tokens was.
  let sent = 0;
  const remindedUserIds = new Set<string>();
  for (const [index, outcome] of delivery.outcomes.entries()) {
    if (outcome.status === "request_failed") continue;
    sent++;
    const candidate = sendable[index];
    if (candidate) remindedUserIds.add(candidate.userId);
  }
  if (remindedUserIds.size > 0) {
    await db
      .update(notificationPrefs)
      .set({ lastRemindedAt: now })
      .where(inArray(notificationPrefs.userId, [...remindedUserIds]));
  }
  const pruned = delivery.prunedTokens.length;

  const result = { candidates, skippedPlayed, sent, pruned };
  logger.info("play reminder job complete", {
    candidates,
    skipped_played: skippedPlayed,
    sent,
    pruned,
  });
  return result;
}
