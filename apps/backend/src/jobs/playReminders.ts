import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { gameScores, notificationPrefs, pushTokens } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { type DbClient, executeRows } from "../lib/sql.js";

const FALLBACK_REMINDER_TIMEZONE = "America/New_York";
const FALLBACK_REMINDER_HOUR = 11;

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK_SIZE = 100;
const REMINDER_DEDUP_HOURS = 20;

const expoTicketResponseSchema = z.object({
  data: z.array(
    z.object({
      status: z.enum(["ok", "error"]),
      details: z
        .object({
          error: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

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

function chunksOf<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
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
  let sent = 0;
  const tokensToPrune = new Set<string>();

  for (const [chunkIndex, chunk] of chunksOf(sendable, EXPO_CHUNK_SIZE).entries()) {
    try {
      const response = await fetchFn(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map((candidate) => ({
            to: candidate.expoPushToken,
            title: "Time to play",
            body: "Your daily games are waiting",
            data: { url: "workshop:///games" },
          })),
        ),
      });
      if (!response.ok) {
        throw new Error(`Expo push request failed with status ${response.status}`);
      }

      const parsed = expoTicketResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Expo push response had an invalid ticket payload");
      if (parsed.data.data.length !== chunk.length) {
        throw new Error("Expo push response ticket count did not match the request");
      }

      sent += chunk.length;
      for (const [index, ticket] of parsed.data.data.entries()) {
        const candidate = chunk[index];
        if (!candidate) continue;
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          tokensToPrune.add(candidate.expoPushToken);
        }
      }

      const remindedUserIds = [...new Set(chunk.map((candidate) => candidate.userId))];
      await db
        .update(notificationPrefs)
        .set({ lastRemindedAt: now })
        .where(inArray(notificationPrefs.userId, remindedUserIds));
    } catch (error) {
      logger.error("play reminder push chunk failed", {
        error,
        chunk_index: chunkIndex,
        token_count: chunk.length,
      });
    }
  }

  let pruned = 0;
  if (tokensToPrune.size > 0) {
    const deleted = await db
      .delete(pushTokens)
      .where(inArray(pushTokens.expoPushToken, [...tokensToPrune]))
      .returning({ expoPushToken: pushTokens.expoPushToken });
    pruned = deleted.length;
  }

  const result = { candidates, skippedPlayed, sent, pruned };
  logger.info("play reminder job complete", {
    candidates,
    skipped_played: skippedPlayed,
    sent,
    pruned,
  });
  return result;
}
