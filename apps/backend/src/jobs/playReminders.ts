import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { autoNudges, gameScores, notificationPrefs, pushTokens } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { type ExpoPushMessage, sendExpoPushMessages } from "../lib/expoPush.js";
import { logger } from "../lib/logger.js";
import { noReminderCanBeDue, refreshReminderSlotsQuietly } from "../lib/reminderSlots.js";
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
  /** Users who got the automatic friends-played nudge instead of the plain reminder. */
  autoNudged: number;
}

/**
 * The automatic nudge (spike 4) for one due user: their friends posted a game
 * they have today and they haven't. Pure, so the copy is unit-tested.
 */
export interface AutoNudgeCandidate {
  userId: string;
  periodKey: string;
  gameId: string;
  title: string;
  position: number | null;
  /** Friends who posted the game today, earliest first. */
  postedIds: string[];
  postedNames: (string | null)[];
  /** Friends who have the game and haven't posted it today. */
  waitingCount: number;
}

/** At least this many friends must have posted the game. */
const AUTO_NUDGE_MIN_FRIENDS = 2;

function joinNames(names: (string | null)[]): string {
  const shown = names.map((name) => name?.trim() || "A friend");
  const [a, b] = shown;
  if (shown.length <= 1) return a ?? "Your friends";
  if (shown.length === 2) return `${a} and ${b}`;
  return `${a}, ${b} and ${shown.length - 2} more`;
}

/** The best game for one user: most friends posted, then "only one left", then home order. */
export function pickAutoNudge(rows: AutoNudgeCandidate[]): AutoNudgeCandidate | null {
  const eligible = rows.filter((row) => row.postedIds.length >= AUTO_NUDGE_MIN_FRIENDS);
  eligible.sort(
    (a, b) =>
      b.postedIds.length - a.postedIds.length ||
      Number(a.waitingCount > 0) - Number(b.waitingCount > 0) ||
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      a.title.localeCompare(b.title),
  );
  return eligible[0] ?? null;
}

/**
 * "You're the only one who hasn't played MapTap today — Sam and Riley are
 * waiting" when every friend who has the game posted it; otherwise the
 * honest "Sam and Riley played MapTap today". Tapping opens that day's board.
 */
export function autoNudgeMessage(
  pick: AutoNudgeCandidate,
): Pick<ExpoPushMessage, "title" | "body" | "data"> {
  const names = joinNames(pick.postedNames);
  const onlyOne = pick.waitingCount === 0;
  return {
    title: onlyOne
      ? `You're the only one who hasn't played ${pick.title} today`
      : `${names} played ${pick.title} today`,
    body: onlyOne
      ? `${names} ${pick.postedIds.length === 1 ? "is" : "are"} waiting`
      : "Your turn — post your score",
    data: {
      kind: "auto_nudge",
      gameId: pick.gameId,
      url: `highscore:///games/${pick.gameId}?date=${pick.periodKey}`,
    },
  };
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

/**
 * Pass one of the job: for the users already due a reminder this hour (and
 * not played today), every game they have that ≥2 friends posted on their
 * local date, minus anyone who already got an automatic nudge that day.
 * Friends across a block are left out. One query over a handful of users.
 */
async function selectAutoNudgeRows(
  db: DbClient,
  now: Date,
  due: { userId: string; timezone: string }[],
): Promise<AutoNudgeCandidate[]> {
  if (due.length === 0) return [];
  const rows = await executeRows<
    Omit<AutoNudgeCandidate, "waitingCount"> & { waitingCount: number | string }
  >(
    db,
    sql`
      WITH due AS (
        SELECT t.user_id, to_char(
          (${now.toISOString()}::timestamptz AT TIME ZONE t.timezone)::date, 'YYYY-MM-DD'
        ) AS period_key
        FROM json_to_recordset(${JSON.stringify(due.map((d) => ({ user_id: d.userId, timezone: d.timezone })))}::json)
          AS t(user_id uuid, timezone text)
        WHERE NOT EXISTS (
          SELECT 1 FROM auto_nudges a
          WHERE a.user_id = t.user_id
            AND a.period_key = to_char(
              (${now.toISOString()}::timestamptz AT TIME ZONE t.timezone)::date, 'YYYY-MM-DD'
            )
        )
      ), friend_edges AS (
        SELECT d.user_id, d.period_key,
          CASE WHEN f.user_low = d.user_id THEN f.user_high ELSE f.user_low END AS friend_id
        FROM due d
        JOIN friendships f ON f.user_low = d.user_id OR f.user_high = d.user_id
      )
      SELECT
        fe.user_id AS "userId",
        fe.period_key AS "periodKey",
        g.id AS "gameId",
        g.title,
        ug.position,
        coalesce(
          array_agg(u.id ORDER BY s.created_at) FILTER (WHERE s.user_id IS NOT NULL), '{}'
        ) AS "postedIds",
        coalesce(
          array_agg(u.display_name ORDER BY s.created_at) FILTER (WHERE s.user_id IS NOT NULL), '{}'
        ) AS "postedNames",
        count(*) FILTER (WHERE s.user_id IS NULL) AS "waitingCount"
      FROM friend_edges fe
      JOIN user_games ug ON ug.user_id = fe.user_id
      JOIN user_games fug ON fug.user_id = fe.friend_id AND fug.game_id = ug.game_id
      JOIN games g ON g.id = ug.game_id
      JOIN users u ON u.id = fe.friend_id
      LEFT JOIN game_scores s
        ON s.game_id = ug.game_id AND s.user_id = fe.friend_id AND s.period_key = fe.period_key
      WHERE NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = fe.user_id AND b.blocked_id = fe.friend_id)
           OR (b.blocker_id = fe.friend_id AND b.blocked_id = fe.user_id)
      )
      GROUP BY fe.user_id, fe.period_key, g.id, g.title, ug.position
      HAVING count(s.user_id) >= ${AUTO_NUDGE_MIN_FRIENDS}
    `,
  );
  return rows.map((row) => ({ ...row, waitingCount: Number(row.waitingCount) }));
}

/**
 * The Lambda's `{ "job": "play-reminders" }` branch, every hour. Skips the
 * database entirely when the stored reminder slots say nobody can be due this
 * hour (`lib/reminderSlots.ts`); otherwise runs the job and refreshes them.
 */
export async function runScheduledPlayReminders(
  now: Date = new Date(),
): Promise<PlayReminderJobResult | { skipped: "no reminder due this hour" }> {
  if (await noReminderCanBeDue(now)) {
    logger.info("play reminder job skipped: no reminder due this hour");
    return { skipped: "no reminder due this hour" };
  }
  const result = await runPlayReminderJob({ now });
  await refreshReminderSlotsQuietly();
  return result;
}

/** The reminder job itself: who is due this hour, and send. */
export async function runPlayReminderJob(
  args: { db?: DbClient; now?: Date; fetchFn?: typeof fetch } = {},
): Promise<PlayReminderJobResult> {
  const config = getConfig();
  const empty: PlayReminderJobResult = {
    candidates: 0,
    skippedPlayed: 0,
    sent: 0,
    pruned: 0,
    autoNudged: 0,
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
    return { candidates, skippedPlayed, sent: 0, pruned: 0, autoNudged: 0 };
  }

  // Pass one (spike 4): a due user whose friends posted a game they have
  // today gets the automatic nudge in place of the plain reminder — same
  // hour, same timezone, same 20h dedup, so still one push a day at most.
  const dueUsers = [
    ...new Map(
      sendable.map((row) => [row.userId, { userId: row.userId, timezone: row.timezone }]),
    ).values(),
  ];
  const autoRows = await selectAutoNudgeRows(db, now, dueUsers);
  const picks = new Map<string, AutoNudgeCandidate>();
  for (const user of dueUsers) {
    const pick = pickAutoNudge(autoRows.filter((row) => row.userId === user.userId));
    if (pick) picks.set(user.userId, pick);
  }
  if (picks.size > 0) {
    // Claimed before sending, so a retried invocation can't send twice; the
    // claim is released below for a user Expo never answered for.
    const claimed = await db
      .insert(autoNudges)
      .values(
        [...picks.values()].map((pick) => ({
          userId: pick.userId,
          periodKey: pick.periodKey,
          gameId: pick.gameId,
          friendIds: pick.postedIds,
          sentAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning({ userId: autoNudges.userId });
    const claimedIds = new Set(claimed.map((row) => row.userId));
    for (const userId of [...picks.keys()]) if (!claimedIds.has(userId)) picks.delete(userId);
  }

  const delivery = await sendExpoPushMessages(
    sendable.map((candidate) => {
      const pick = picks.get(candidate.userId);
      return pick
        ? { to: candidate.expoPushToken, ...autoNudgeMessage(pick) }
        : {
            to: candidate.expoPushToken,
            title: "Time to play",
            body: "Your daily games are waiting",
            data: { url: "highscore:///" },
          };
    }),
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
  let autoNudged = 0;
  for (const [userId, pick] of picks) {
    if (remindedUserIds.has(userId)) {
      autoNudged++;
      logger.info("auto nudge sent", {
        user_id: userId,
        game_id: pick.gameId,
        period_key: pick.periodKey,
        friends_posted: pick.postedIds.length,
        friends_waiting: pick.waitingCount,
        variant: pick.waitingCount === 0 ? "only_one" : "friends_played",
      });
    } else {
      await db
        .delete(autoNudges)
        .where(and(eq(autoNudges.userId, userId), eq(autoNudges.periodKey, pick.periodKey)));
    }
  }
  const pruned = delivery.prunedTokens.length;

  // Each chunk swallows its own error, so a total Expo outage ends "successfully".
  if (sent === 0) {
    logger.error("job failed", { job: "play-reminders", reason: "no push request succeeded" });
  }
  const result = { candidates, skippedPlayed, sent, pruned, autoNudged };
  logger.info("play reminder job complete", {
    candidates,
    skipped_played: skippedPlayed,
    sent,
    pruned,
    auto_nudged: autoNudged,
  });
  return result;
}
