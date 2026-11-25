// Weekly cooperative quests — spike #10. One quest per friend pair per ISO
// week: "post N scores together this week", N = `friendQuestTarget` of the
// pair's two previous weeks (combined), between 6 and 20. No opt-in, no
// rewards. Rules:
//
// - **Generation is lazy**: the first `GET /v1/friends/quests` a player makes in
//   a week fills their slots (`FRIEND_QUEST_MAX_PER_USER`, 5) with friends who
//   both posted in the last `FRIEND_QUEST_ACTIVE_DAYS` (14, today inclusive),
//   most recently active pairs first, skipping friends whose own five slots are
//   taken. A row, once made, is the pair's quest for the week for both players.
// - **Progress is counted, not stored**: every `game_scores` row either player
//   has dated inside the week (Monday–Sunday period keys).
// - **Completion is written once** (`friend_quest_completions`), by whichever
//   score post or read first sees the count reach the target; that insert is
//   what sends the completion push to both players, so the push goes out once.
// - A quest stops showing the moment the pair is no longer friends (a block
//   drops the friendship too).

import type { FriendQuest, FriendQuestsResponse } from "@workshop/shared/friends";
import {
  FRIEND_QUEST_ACTIVE_DAYS,
  FRIEND_QUEST_MAX_PER_USER,
  friendQuestTarget,
  isoWeekStart,
  shiftPeriodKey,
} from "@workshop/shared/games";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { friendQuestCompletions, friendQuests, pushTokens } from "../db/schema.js";
import { toIsoString } from "./dates.js";
import { type ExpoPushMessage, sendExpoPushMessages } from "./expoPush.js";
import { canonicalPair, friendsOf } from "./friends.js";
import { logger } from "./logger.js";
import { type DbClient, executeRows } from "./sql.js";

/** Upper bound on the Expo request so a slow push can't hold the response. */
const QUEST_PUSH_TIMEOUT_MS = 3000;

interface QuestRow {
  weekStart: string;
  userLow: string;
  userHigh: string;
  target: number;
  lowCount: number;
  highCount: number;
  lowName: string | null;
  highName: string | null;
  completedAt: Date | string | null;
  lowSeenAt: Date | string | null;
  highSeenAt: Date | string | null;
}

export interface QuestCandidate {
  friendId: string;
  /** The friend's latest score day in the active window. */
  friendLast: string;
  /** The friend's scores in the active window. */
  friendCount: number;
}

/**
 * Pure: which friends get this week's open slots. Most recently active pairs
 * first — a pair is as recent as the *less* recent of its two players' latest
 * score days (both have to be playing) — then the friend's 14-day score count,
 * then id for a stable order.
 */
export function pickQuestPartners(
  viewerLast: string,
  candidates: QuestCandidate[],
  slots: number,
): QuestCandidate[] {
  if (slots <= 0) return [];
  const pairRecency = (c: QuestCandidate) =>
    c.friendLast < viewerLast ? c.friendLast : viewerLast;
  return [...candidates]
    .sort(
      (a, b) =>
        pairRecency(b).localeCompare(pairRecency(a)) ||
        b.friendCount - a.friendCount ||
        a.friendId.localeCompare(b.friendId),
    )
    .slice(0, slots);
}

/**
 * Fill the viewer's open quest slots for the week containing `today`. Returns
 * how many quests were created. Idempotent per pair and week (primary key).
 */
export async function ensureWeeklyQuests(
  viewerId: string,
  today: string,
  db: DbClient = getDb(),
): Promise<number> {
  const weekStart = isoWeekStart(today);
  const friendIds = await friendsOf(viewerId);
  if (friendIds.length === 0) return 0;

  const people = [viewerId, ...friendIds];
  const peopleSql = sql.join(
    people.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // Every quest this week involving the viewer or a friend: the viewer's
  // existing pairs and each friend's used slots, in one read.
  const weekQuests = await executeRows<{ userLow: string; userHigh: string }>(
    db,
    sql`SELECT user_low AS "userLow", user_high AS "userHigh" FROM friend_quests
        WHERE week_start = ${weekStart}
          AND (user_low IN (${peopleSql}) OR user_high IN (${peopleSql}))`,
  );
  const slotsUsed = new Map<string, number>();
  const pairedWithViewer = new Set<string>();
  for (const q of weekQuests) {
    slotsUsed.set(q.userLow, (slotsUsed.get(q.userLow) ?? 0) + 1);
    slotsUsed.set(q.userHigh, (slotsUsed.get(q.userHigh) ?? 0) + 1);
    if (q.userLow === viewerId) pairedWithViewer.add(q.userHigh);
    if (q.userHigh === viewerId) pairedWithViewer.add(q.userLow);
  }
  const open = FRIEND_QUEST_MAX_PER_USER - (slotsUsed.get(viewerId) ?? 0);
  if (open <= 0) return 0;

  const activeSince = shiftPeriodKey(today, -(FRIEND_QUEST_ACTIVE_DAYS - 1));
  const activity = await executeRows<{ userId: string; last: string; n: number }>(
    db,
    sql`SELECT user_id AS "userId", max(period_key) AS "last", count(*)::int AS "n"
        FROM game_scores
        WHERE user_id IN (${peopleSql}) AND period_key >= ${activeSince} AND period_key <= ${today}
        GROUP BY user_id`,
  );
  const byUser = new Map(activity.map((a) => [a.userId, a]));
  const mine = byUser.get(viewerId);
  if (!mine) return 0;

  const candidates: QuestCandidate[] = [];
  for (const friendId of friendIds) {
    const theirs = byUser.get(friendId);
    if (!theirs || pairedWithViewer.has(friendId)) continue;
    if ((slotsUsed.get(friendId) ?? 0) >= FRIEND_QUEST_MAX_PER_USER) continue;
    candidates.push({ friendId, friendLast: theirs.last, friendCount: Number(theirs.n) });
  }
  const picked = pickQuestPartners(mine.last, candidates, open);
  if (picked.length === 0) return 0;

  // Targets from the two ISO weeks before this one, both players combined.
  const trailingFrom = shiftPeriodKey(weekStart, -14);
  const trailingTo = shiftPeriodKey(weekStart, -1);
  const trailingIds = sql.join(
    [viewerId, ...picked.map((p) => p.friendId)].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const trailing = await executeRows<{ userId: string; n: number }>(
    db,
    sql`SELECT user_id AS "userId", count(*)::int AS "n" FROM game_scores
        WHERE user_id IN (${trailingIds}) AND period_key >= ${trailingFrom} AND period_key <= ${trailingTo}
        GROUP BY user_id`,
  );
  const trailingBy = new Map(trailing.map((t) => [t.userId, Number(t.n)]));
  const viewerTrailing = trailingBy.get(viewerId) ?? 0;

  const values = picked.map((p) => ({
    weekStart,
    ...canonicalPair(viewerId, p.friendId),
    target: friendQuestTarget(viewerTrailing + (trailingBy.get(p.friendId) ?? 0)),
  }));
  const inserted = await db
    .insert(friendQuests)
    .values(values)
    .onConflictDoNothing()
    .returning({ userLow: friendQuests.userLow, userHigh: friendQuests.userHigh });
  if (inserted.length > 0) {
    logger.info("friend_quest_generated", {
      user_id: viewerId,
      week_start: weekStart,
      quests: inserted.length,
      targets: values.map((v) => v.target),
    });
  }
  return inserted.length;
}

/** The viewer's quests for the given weeks, still-friends only, with live counts. */
async function loadQuestRows(
  db: DbClient,
  viewerId: string,
  weekStarts: string[],
): Promise<QuestRow[]> {
  const weeks = sql.join(
    weekStarts.map((w) => sql`${w}`),
    sql`, `,
  );
  return executeRows<QuestRow>(
    db,
    sql`
    SELECT q.week_start AS "weekStart", q.user_low AS "userLow", q.user_high AS "userHigh",
      q.target AS "target",
      (SELECT count(*)::int FROM game_scores s WHERE s.user_id = q.user_low
        AND s.period_key >= q.week_start
        AND s.period_key <= to_char(q.week_start::date + 6, 'YYYY-MM-DD')) AS "lowCount",
      (SELECT count(*)::int FROM game_scores s WHERE s.user_id = q.user_high
        AND s.period_key >= q.week_start
        AND s.period_key <= to_char(q.week_start::date + 6, 'YYYY-MM-DD')) AS "highCount",
      ul.display_name AS "lowName", uh.display_name AS "highName",
      c.completed_at AS "completedAt", c.low_seen_at AS "lowSeenAt", c.high_seen_at AS "highSeenAt"
    FROM friend_quests q
    JOIN friendships f ON f.user_low = q.user_low AND f.user_high = q.user_high
    JOIN users ul ON ul.id = q.user_low
    JOIN users uh ON uh.id = q.user_high
    LEFT JOIN friend_quest_completions c
      ON c.week_start = q.week_start AND c.user_low = q.user_low AND c.user_high = q.user_high
    WHERE q.week_start IN (${weeks})
      AND (q.user_low = ${viewerId}::uuid OR q.user_high = ${viewerId}::uuid)
  `,
  );
}

/** One completion push per device of both players, each naming the other. */
export function buildQuestCompletePushMessages(
  players: { id: string; displayName: string | null; tokens: string[] }[],
  count: number,
): ExpoPushMessage[] {
  const [a, b] = players;
  if (!a || !b) return [];
  const messageFor = (to: string, other: { id: string; displayName: string | null }) => ({
    to,
    title: "Quest complete 🎉",
    body: `You and ${other.displayName?.trim() || "your friend"} posted ${count} scores together this week.`,
    data: { kind: "friend_quest", userId: other.id, url: "highscore:///" },
    sound: "default" as const,
  });
  return [...a.tokens.map((to) => messageFor(to, b)), ...b.tokens.map((to) => messageFor(to, a))];
}

async function sendQuestCompletePush(db: DbClient, row: QuestRow, count: number): Promise<void> {
  try {
    const tokenRows = await db
      .select({ userId: pushTokens.userId, token: pushTokens.expoPushToken })
      .from(pushTokens)
      .where(inArray(pushTokens.userId, [row.userLow, row.userHigh]))
      .orderBy(pushTokens.expoPushToken);
    if (tokenRows.length === 0) return;
    const tokensOf = (id: string) => tokenRows.filter((t) => t.userId === id).map((t) => t.token);
    const messages = buildQuestCompletePushMessages(
      [
        { id: row.userLow, displayName: row.lowName, tokens: tokensOf(row.userLow) },
        { id: row.userHigh, displayName: row.highName, tokens: tokensOf(row.userHigh) },
      ],
      count,
    );
    const delivery = await sendExpoPushMessages(messages, {
      db,
      fetchFn: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(QUEST_PUSH_TIMEOUT_MS) }),
      onChunkError: (error, chunkIndex, tokenCount) =>
        logger.error("friend quest push chunk failed", {
          error,
          chunk_index: chunkIndex,
          token_count: tokenCount,
        }),
    });
    logger.info("friend quest push sent", {
      week_start: row.weekStart,
      tokens: messages.length,
      sent: delivery.sent,
      failed: delivery.failed,
    });
  } catch (error) {
    logger.error("friend quest push failed", { error, week_start: row.weekStart });
  }
}

/**
 * Record completion for every row whose count reached its target and has none
 * yet. The insert is the once-only gate: only the request whose insert lands
 * logs and pushes. Mutates the rows so the caller's response shows it.
 */
async function completeReached(
  db: DbClient,
  rows: QuestRow[],
  pushWeek: string | null,
): Promise<void> {
  for (const row of rows) {
    const count = Number(row.lowCount) + Number(row.highCount);
    if (row.completedAt || count < row.target) continue;
    const [done] = await db
      .insert(friendQuestCompletions)
      .values({
        weekStart: row.weekStart,
        userLow: row.userLow,
        userHigh: row.userHigh,
        target: row.target,
        scoreCount: count,
      })
      .onConflictDoNothing()
      .returning({ completedAt: friendQuestCompletions.completedAt });
    if (!done) continue;
    row.completedAt = done.completedAt;
    logger.info("friend_quest_completed", {
      week_start: row.weekStart,
      user_low: row.userLow,
      user_high: row.userHigh,
      target: row.target,
      count,
    });
    // A late-detected completion from last week isn't news any more.
    if (row.weekStart === pushWeek) await sendQuestCompletePush(db, row, count);
  }
}

function toQuest(row: QuestRow, viewerId: string): FriendQuest {
  const viewerIsLow = row.userLow === viewerId;
  const viewerCount = Number(viewerIsLow ? row.lowCount : row.highCount);
  const friendCount = Number(viewerIsLow ? row.highCount : row.lowCount);
  const seenAt = viewerIsLow ? row.lowSeenAt : row.highSeenAt;
  const completedAt = row.completedAt ? toIsoString(row.completedAt) : null;
  return {
    friend: {
      userId: viewerIsLow ? row.userHigh : row.userLow,
      displayName: viewerIsLow ? row.highName : row.lowName,
    },
    weekStart: row.weekStart,
    weekEnd: shiftPeriodKey(row.weekStart, 6),
    target: row.target,
    count: viewerCount + friendCount,
    viewerCount,
    friendCount,
    completedAt,
    celebrate: completedAt !== null && !seenAt,
  };
}

/** Open quests first, then the closest to done, then by name. */
function questOrder(a: FriendQuest, b: FriendQuest): number {
  const openA = a.completedAt ? 1 : 0;
  const openB = b.completedAt ? 1 : 0;
  return (
    openA - openB ||
    b.count / b.target - a.count / a.target ||
    (a.friend.displayName ?? "").localeCompare(b.friend.displayName ?? "")
  );
}

/** `GET /v1/friends/quests` — generate this week's quests if needed, then read them. */
export async function loadFriendQuests(
  viewerId: string,
  today: string,
  db: DbClient = getDb(),
): Promise<FriendQuestsResponse> {
  const weekStart = isoWeekStart(today);
  const lastWeek = shiftPeriodKey(weekStart, -7);
  await ensureWeeklyQuests(viewerId, today, db);
  const rows = await loadQuestRows(db, viewerId, [weekStart, lastWeek]);
  await completeReached(db, rows, weekStart);
  const all = rows.map((r) => toQuest(r, viewerId));
  return {
    weekStart,
    weekEnd: shiftPeriodKey(weekStart, 6),
    quests: all.filter((q) => q.weekStart === weekStart).sort(questOrder),
    celebrations: all.filter((q) => q.celebrate).sort(questOrder),
  };
}

/**
 * After a score post dated `periodKey`: complete any of the poster's quests
 * for that week the post pushed over the target. Best-effort; never throws.
 */
export async function completeQuestsAfterPost(userId: string, periodKey: string): Promise<void> {
  try {
    const db = getDb();
    const weekStart = isoWeekStart(periodKey);
    const rows = await loadQuestRows(db, userId, [weekStart]);
    if (rows.length === 0) return;
    await completeReached(db, rows, weekStart);
  } catch (error) {
    logger.error("friend quest completion check failed", { error, user_id: userId });
  }
}

/** `POST /v1/friends/quests/seen` — the viewer acknowledged one celebration. */
export async function markQuestSeen(
  viewerId: string,
  friendId: string,
  weekStart: string,
  db: DbClient = getDb(),
): Promise<boolean> {
  if (friendId === viewerId) return false;
  const pair = canonicalPair(viewerId, friendId);
  const now = new Date();
  const updated = await db
    .update(friendQuestCompletions)
    .set(pair.userLow === viewerId ? { lowSeenAt: now } : { highSeenAt: now })
    .where(
      and(
        eq(friendQuestCompletions.weekStart, weekStart),
        eq(friendQuestCompletions.userLow, pair.userLow),
        eq(friendQuestCompletions.userHigh, pair.userHigh),
      ),
    )
    .returning({ weekStart: friendQuestCompletions.weekStart });
  return updated.length > 0;
}
