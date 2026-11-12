// Nudges: after posting a score, a player pokes a friend who has also played
// that game that day, and the friend gets a push. `sendGameNudge` owns every
// rule (friends only, both played, the friend is reachable, once per friend
// per game per day, `NUDGE_DAILY_LIMIT` a day unless the sender is an admin);
// `loadNudgeState` is the same rules read-only, for the board. Delivery goes
// through the shared `sendExpoPushMessages` and is best-effort: a push
// problem never fails the request, it is reported as `delivered: false`.

import type { GameNudgeRefusal, GameNudgeState } from "@workshop/shared/games";
import { NUDGE_DAILY_LIMIT } from "@workshop/shared/games";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type DbGame, gameNudges, gameScores, pushTokens, users } from "../db/schema.js";
import { isAdminUser } from "./admin.js";
import { blockedEitherWay } from "./blocks.js";
import { type ExpoPushMessage, sendExpoPushMessages } from "./expoPush.js";
import { friendsOf } from "./friends.js";
import { todayPeriodKey } from "./gameShapes.js";
import { logger } from "./logger.js";
import { requestOriginColumns } from "./requestContext.js";

/** Upper bound on the Expo request so a slow push can't hold the response. */
const NUDGE_PUSH_TIMEOUT_MS = 3000;
const DAY_MS = 86_400_000;

/**
 * A nudge is for the current day. Period keys are the client's local date, so
 * "current" is the server's UTC day give or take one.
 */
export function isNudgeablePeriod(periodKey: string, now: Date = new Date()): boolean {
  return [-1, 0, 1].some(
    (offset) => todayPeriodKey(new Date(now.getTime() + offset * DAY_MS)) === periodKey,
  );
}

/** One message per registered device of the nudged friend. */
function buildNudgePushMessages(
  sender: { id: string; displayName: string | null },
  game: Pick<DbGame, "id" | "title">,
  periodKey: string,
  tokens: string[],
): ExpoPushMessage[] {
  const name = sender.displayName?.trim() || "A friend";
  return tokens.map((to) => ({
    to,
    title: `${name} nudged you`,
    body: `${name} just played ${game.title}. See how you stack up.`,
    data: {
      kind: "nudge",
      userId: sender.id,
      gameId: game.id,
      url: `highscore:///games/${game.id}?date=${periodKey}`,
    },
    sound: "default",
  }));
}

async function senderIsAdmin(senderId: string): Promise<boolean> {
  const [actor] = await getDb()
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, senderId))
    .limit(1);
  return actor ? isAdminUser(actor) : false;
}

async function nudgesSentOn(senderId: string, periodKey: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(gameNudges)
    .where(and(eq(gameNudges.senderId, senderId), eq(gameNudges.periodKey, periodKey)));
  return row?.count ?? 0;
}

/**
 * The sender's allowance plus, among `candidateIds` (the friends on one
 * board), who was already nudged and who has a device to receive one.
 */
export async function loadNudgeState(
  senderId: string,
  gameId: string,
  periodKey: string,
  candidateIds: string[],
): Promise<GameNudgeState> {
  const db = getDb();
  const [isAdmin, sent, nudged, reachable] = await Promise.all([
    senderIsAdmin(senderId),
    nudgesSentOn(senderId, periodKey),
    candidateIds.length === 0
      ? []
      : db
          .select({ userId: gameNudges.recipientId })
          .from(gameNudges)
          .where(
            and(
              eq(gameNudges.senderId, senderId),
              eq(gameNudges.periodKey, periodKey),
              eq(gameNudges.gameId, gameId),
              inArray(gameNudges.recipientId, candidateIds),
            ),
          ),
    candidateIds.length === 0
      ? []
      : db
          .selectDistinct({ userId: pushTokens.userId })
          .from(pushTokens)
          .where(inArray(pushTokens.userId, candidateIds)),
  ]);
  return {
    limit: isAdmin ? null : NUDGE_DAILY_LIMIT,
    remaining: isAdmin ? null : Math.max(0, NUDGE_DAILY_LIMIT - sent),
    nudgedUserIds: nudged.map((row) => row.userId),
    reachableUserIds: reachable.map((row) => row.userId),
  };
}

export type SendGameNudgeResult =
  | { ok: true; delivered: boolean }
  /** Not a friend (or blocked): indistinguishable from "no such user". */
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: GameNudgeRefusal };

export async function sendGameNudge(
  senderId: string,
  recipientId: string,
  game: Pick<DbGame, "id" | "title">,
  periodKey: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<SendGameNudgeResult> {
  const db = getDb();
  const [friendIds, blocked] = await Promise.all([
    friendsOf(senderId),
    blockedEitherWay(senderId, recipientId),
  ]);
  if (blocked || !friendIds.includes(recipientId)) return { ok: false, reason: "not_found" };

  const [played, tokenRows, isAdmin] = await Promise.all([
    db
      .select({ userId: gameScores.userId })
      .from(gameScores)
      .where(
        and(
          eq(gameScores.gameId, game.id),
          eq(gameScores.periodKey, periodKey),
          inArray(gameScores.userId, [senderId, recipientId]),
        ),
      ),
    db
      .select({ token: pushTokens.expoPushToken })
      .from(pushTokens)
      .where(eq(pushTokens.userId, recipientId))
      .orderBy(pushTokens.expoPushToken),
    senderIsAdmin(senderId),
  ]);
  const playedIds = new Set(played.map((row) => row.userId));
  if (!playedIds.has(senderId)) return { ok: false, reason: "not_played" };
  if (!playedIds.has(recipientId)) return { ok: false, reason: "friend_not_played" };
  if (tokenRows.length === 0) return { ok: false, reason: "unreachable" };
  if (!isAdmin && (await nudgesSentOn(senderId, periodKey)) >= NUDGE_DAILY_LIMIT) {
    return { ok: false, reason: "daily_limit" };
  }

  const inserted = await db
    .insert(gameNudges)
    .values({ senderId, recipientId, gameId: game.id, periodKey, ...requestOriginColumns() })
    .onConflictDoNothing()
    .returning({ recipientId: gameNudges.recipientId });
  if (inserted.length === 0) return { ok: false, reason: "already_nudged" };
  // Two requests can both pass the count above; the loser takes its row back.
  if (!isAdmin && (await nudgesSentOn(senderId, periodKey)) > NUDGE_DAILY_LIMIT) {
    await db
      .delete(gameNudges)
      .where(
        and(
          eq(gameNudges.senderId, senderId),
          eq(gameNudges.periodKey, periodKey),
          eq(gameNudges.gameId, game.id),
          eq(gameNudges.recipientId, recipientId),
        ),
      );
    return { ok: false, reason: "daily_limit" };
  }

  let delivered = false;
  try {
    const [sender] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, senderId))
      .limit(1);
    const messages = buildNudgePushMessages(
      sender ?? { id: senderId, displayName: null },
      game,
      periodKey,
      tokenRows.map((row) => row.token),
    );
    const fetchFn = opts.fetchFn ?? fetch;
    const delivery = await sendExpoPushMessages(messages, {
      db,
      fetchFn: (input, init) =>
        fetchFn(input, { ...init, signal: AbortSignal.timeout(NUDGE_PUSH_TIMEOUT_MS) }),
      onChunkError: (error, chunkIndex, tokenCount) =>
        logger.error("nudge push chunk failed", {
          error,
          chunk_index: chunkIndex,
          token_count: tokenCount,
        }),
    });
    delivered = delivery.sent > 0;
    logger.info("nudge push sent", {
      sender_id: senderId,
      recipient_id: recipientId,
      game_id: game.id,
      tokens: messages.length,
      sent: delivery.sent,
      failed: delivery.failed,
      pruned: delivery.prunedTokens.length,
    });
  } catch (error) {
    logger.error("nudge push failed", { error, recipient_id: recipientId });
  }
  return { ok: true, delivered };
}
