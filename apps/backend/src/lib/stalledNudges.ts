// Spike 4: nudge friends who haven't played yet. After a player posts a score,
// the response names the friends who have that game in their list, haven't
// posted it for the day, can receive a push and haven't been nudged by them on
// it today (`loadStalledFriends` → `UpsertGameScoreResponse.stalledFriends`);
// one tap sends each of them a push (`sendStalledNudges`,
// `POST /v1/games/:id/nudges/stalled`). Same table, same once-per-friend-per-
// game-per-day key and the same daily allowance as the board poke
// (`lib/nudges.ts`), recorded with `surface = 'post_notice'`. Unlike the board
// poke the sender does not need notifications on: turning them on is what the
// client offers right after the first nudge ("want to know when they post
// back?"), and `recordNudgeAnswers` is what makes that promise true — when a
// nudged friend posts the game within 24h, the sender gets a push.

import type {
  GameNudgeRefusal,
  SendStalledNudgesResponse,
  StalledFriendsNudge,
} from "@workshop/shared/games";
import { NUDGE_DAILY_LIMIT } from "@workshop/shared/games";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { type DbGame, gameNudges, gameScores, pushTokens, userGames, users } from "../db/schema.js";
import { blockedIdsFor } from "./blocks.js";
import { type ExpoPushMessage, sendExpoPushMessages } from "./expoPush.js";
import { friendsOf } from "./friends.js";
import { logger } from "./logger.js";
import { isNudgeablePeriod, NUDGE_PUSH_TIMEOUT_MS, nudgesSentOn, senderIsAdmin } from "./nudges.js";
import { requestOriginColumns } from "./requestContext.js";
import { executeRows } from "./sql.js";

/** How long after a nudge a post still counts as the answer to it. */
const ANSWER_WINDOW_HOURS = 24;

type Refusal = GameNudgeRefusal | "not_found";

function boardUrl(gameId: string, periodKey: string): string {
  return `highscore:///games/${gameId}?date=${periodKey}`;
}

function firstName(displayName: string | null | undefined, fallback: string): string {
  return displayName?.trim() || fallback;
}

async function allowance(
  senderId: string,
  periodKey: string,
): Promise<{ limit: number | null; remaining: number | null }> {
  const [isAdmin, sent] = await Promise.all([
    senderIsAdmin(senderId),
    nudgesSentOn(senderId, periodKey),
  ]);
  return isAdmin
    ? { limit: null, remaining: null }
    : { limit: NUDGE_DAILY_LIMIT, remaining: Math.max(0, NUDGE_DAILY_LIMIT - sent) };
}

/**
 * The "Nudge Sam, Riley — they haven't played yet" block for a score just
 * posted, or null when there is nobody to offer (or no nudges left, or the
 * day isn't current). One query for the friends, two small ones for the
 * allowance.
 */
async function loadStalledFriends(
  userId: string,
  gameId: string,
  periodKey: string,
  now: Date = new Date(),
): Promise<StalledFriendsNudge | null> {
  if (!isNudgeablePeriod(periodKey, now)) return null;
  const friends = await executeRows<{ userId: string; displayName: string | null }>(
    getDb(),
    sql`
      WITH my_friends AS (
        SELECT CASE WHEN f.user_low = ${userId} THEN f.user_high ELSE f.user_low END AS id
        FROM friendships f
        WHERE f.user_low = ${userId} OR f.user_high = ${userId}
      )
      SELECT u.id AS "userId", u.display_name AS "displayName"
      FROM my_friends mf
      JOIN users u ON u.id = mf.id
      JOIN user_games ug ON ug.user_id = mf.id AND ug.game_id = ${gameId}
      WHERE NOT EXISTS (
          SELECT 1 FROM game_scores s
          WHERE s.game_id = ${gameId} AND s.user_id = mf.id AND s.period_key = ${periodKey}
        )
        AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.user_id = mf.id)
        AND NOT EXISTS (
          SELECT 1 FROM game_nudges n
          WHERE n.sender_id = ${userId} AND n.recipient_id = mf.id
            AND n.game_id = ${gameId} AND n.period_key = ${periodKey}
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = ${userId} AND b.blocked_id = mf.id)
             OR (b.blocker_id = mf.id AND b.blocked_id = ${userId})
        )
      ORDER BY lower(coalesce(u.display_name, '')), u.id
    `,
  );
  if (friends.length === 0) return null;
  const { limit, remaining } = await allowance(userId, periodKey);
  if (remaining === 0) return null;
  return { friends, limit, remaining };
}

/**
 * Nudge each of `recipientIds` (in order) about `game` on `periodKey`. Each
 * recipient is judged alone; refusals don't stop the others. Recipients past
 * the daily allowance are refused `daily_limit`. One Expo request for the
 * lot; a recipient none of whose devices Expo accepted is taken back
 * (`push_failed`), so nothing is recorded or spent without being sent.
 */
export async function sendStalledNudges(
  senderId: string,
  recipientIds: string[],
  game: Pick<DbGame, "id" | "title">,
  periodKey: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<SendStalledNudgesResponse> {
  const db = getDb();
  const ordered = [...new Set(recipientIds)].filter((id) => id !== senderId);
  const refused: { userId: string; reason: Refusal }[] = [];
  const refuse = (userId: string, reason: Refusal) => refused.push({ userId, reason });

  const [friendIds, blocked, senderPlayed] = await Promise.all([
    friendsOf(senderId),
    blockedIdsFor(senderId),
    db
      .select({ userId: gameScores.userId })
      .from(gameScores)
      .where(
        and(
          eq(gameScores.gameId, game.id),
          eq(gameScores.periodKey, periodKey),
          eq(gameScores.userId, senderId),
        ),
      )
      .limit(1),
  ]);
  const friendSet = new Set(friendIds);
  const friends = ordered.filter((id) => {
    if (friendSet.has(id) && !blocked.has(id)) return true;
    refuse(id, "not_found");
    return false;
  });
  const finish = async (nudged: string[]): Promise<SendStalledNudgesResponse> => {
    const { limit, remaining } = await allowance(senderId, periodKey);
    return { nudged, refused, limit, remaining };
  };
  if (friends.length === 0) return finish([]);
  if (senderPlayed.length === 0) {
    for (const id of friends) refuse(id, "not_played");
    return finish([]);
  }

  const [haveGame, played, tokens, already] = await Promise.all([
    db
      .select({ userId: userGames.userId })
      .from(userGames)
      .where(and(eq(userGames.gameId, game.id), inArray(userGames.userId, friends))),
    db
      .select({ userId: gameScores.userId })
      .from(gameScores)
      .where(
        and(
          eq(gameScores.gameId, game.id),
          eq(gameScores.periodKey, periodKey),
          inArray(gameScores.userId, friends),
        ),
      ),
    db
      .select({ userId: pushTokens.userId, token: pushTokens.expoPushToken })
      .from(pushTokens)
      .where(inArray(pushTokens.userId, friends))
      .orderBy(pushTokens.expoPushToken),
    db
      .select({ userId: gameNudges.recipientId })
      .from(gameNudges)
      .where(
        and(
          eq(gameNudges.senderId, senderId),
          eq(gameNudges.periodKey, periodKey),
          eq(gameNudges.gameId, game.id),
          inArray(gameNudges.recipientId, friends),
        ),
      ),
  ]);
  const hasGame = new Set(haveGame.map((r) => r.userId));
  const playedIds = new Set(played.map((r) => r.userId));
  const alreadyIds = new Set(already.map((r) => r.userId));
  const tokensFor = new Map<string, string[]>();
  for (const row of tokens)
    tokensFor.set(row.userId, [...(tokensFor.get(row.userId) ?? []), row.token]);

  const eligible = friends.filter((id) => {
    if (!hasGame.has(id)) refuse(id, "friend_lacks_game");
    else if (playedIds.has(id)) refuse(id, "friend_already_played");
    else if (!tokensFor.has(id)) refuse(id, "unreachable");
    else if (alreadyIds.has(id)) refuse(id, "already_nudged");
    else return true;
    return false;
  });
  const { remaining } = await allowance(senderId, periodKey);
  const allowed = remaining === null ? eligible : eligible.slice(0, remaining);
  for (const id of eligible.slice(allowed.length)) refuse(id, "daily_limit");
  if (allowed.length === 0) return finish([]);

  const deleteRows = (ids: string[]) =>
    ids.length === 0
      ? Promise.resolve()
      : db
          .delete(gameNudges)
          .where(
            and(
              eq(gameNudges.senderId, senderId),
              eq(gameNudges.periodKey, periodKey),
              eq(gameNudges.gameId, game.id),
              inArray(gameNudges.recipientId, ids),
            ),
          )
          .then(() => undefined);

  const inserted = await db
    .insert(gameNudges)
    .values(
      allowed.map((recipientId) => ({
        senderId,
        recipientId,
        gameId: game.id,
        periodKey,
        surface: "post_notice",
        ...requestOriginColumns(),
      })),
    )
    .onConflictDoNothing()
    .returning({ recipientId: gameNudges.recipientId });
  const insertedIds = new Set(inserted.map((r) => r.recipientId));
  let mine = allowed.filter((id) => {
    if (insertedIds.has(id)) return true;
    refuse(id, "already_nudged");
    return false;
  });
  // Two requests can both pass the allowance; the overflow takes its rows back.
  if (remaining !== null && mine.length > 0) {
    const over = (await nudgesSentOn(senderId, periodKey)) - NUDGE_DAILY_LIMIT;
    if (over > 0) {
      const back = mine.slice(Math.max(0, mine.length - over));
      await deleteRows(back);
      for (const id of back) refuse(id, "daily_limit");
      mine = mine.slice(0, mine.length - back.length);
    }
  }
  if (mine.length === 0) return finish([]);

  const [sender] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, senderId))
    .limit(1);
  const name = firstName(sender?.displayName, "A friend");
  const messages: (ExpoPushMessage & { recipientId: string })[] = mine.flatMap((recipientId) =>
    (tokensFor.get(recipientId) ?? []).map((to) => ({
      recipientId,
      to,
      title: `${name} is waiting for your ${game.title} score`,
      body: "They posted today — your turn",
      data: {
        kind: "nudge_waiting",
        userId: senderId,
        gameId: game.id,
        url: boardUrl(game.id, periodKey),
      },
      sound: "default" as const,
    })),
  );
  const delivered = new Set<string>();
  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const delivery = await sendExpoPushMessages(
      messages.map(({ recipientId: _r, ...message }) => message),
      {
        db,
        fetchFn: (input, init) =>
          fetchFn(input, { ...init, signal: AbortSignal.timeout(NUDGE_PUSH_TIMEOUT_MS) }),
        onChunkError: (error, chunkIndex, tokenCount) =>
          logger.error("nudge push chunk failed", {
            error,
            surface: "post_notice",
            chunk_index: chunkIndex,
            token_count: tokenCount,
          }),
      },
    );
    for (const [index, outcome] of delivery.outcomes.entries()) {
      const recipientId = messages[index]?.recipientId;
      if (recipientId && outcome.status === "ok") delivered.add(recipientId);
    }
  } catch (error) {
    logger.error("nudge push failed", { error, surface: "post_notice" });
  }
  const failed = mine.filter((id) => !delivered.has(id));
  await deleteRows(failed);
  for (const id of failed) refuse(id, "push_failed");
  const nudged = mine.filter((id) => delivered.has(id));
  logger.info("nudge sent", {
    surface: "post_notice",
    sender_id: senderId,
    game_id: game.id,
    period_key: periodKey,
    requested: ordered.length,
    nudged: nudged.length,
    refused: refused.length,
  });
  return finish(nudged);
}

/**
 * A score was just posted: stamp `answered_at` on every "haven't played yet"
 * nudge the poster got for this game in the last 24h, and tell each sender
 * ("Sam posted MapTap"). Best-effort and bounded — it can never fail or hold
 * the post for long; the stamp is the measurement even when the push fails.
 */
async function recordNudgeAnswers(
  posterId: string,
  game: Pick<DbGame, "id" | "title">,
  periodKey: string,
  opts: { now?: Date; fetchFn?: typeof fetch } = {},
): Promise<number> {
  const now = opts.now ?? new Date();
  try {
    const db = getDb();
    const answered = await executeRows<{ senderId: string }>(
      db,
      sql`
        UPDATE game_nudges SET answered_at = ${now.toISOString()}::timestamptz
        WHERE recipient_id = ${posterId}
          AND game_id = ${game.id}
          AND surface = 'post_notice'
          AND answered_at IS NULL
          AND created_at > ${now.toISOString()}::timestamptz - (${ANSWER_WINDOW_HOURS} * INTERVAL '1 hour')
        RETURNING sender_id AS "senderId"
      `,
    );
    const senderIds = [...new Set(answered.map((row) => row.senderId))];
    if (senderIds.length === 0) return 0;
    const [poster, tokens] = await Promise.all([
      db.select({ displayName: users.displayName }).from(users).where(eq(users.id, posterId)),
      db
        .select({ token: pushTokens.expoPushToken })
        .from(pushTokens)
        .where(inArray(pushTokens.userId, senderIds))
        .orderBy(pushTokens.expoPushToken),
    ]);
    const name = firstName(poster[0]?.displayName, "Your friend");
    let sent = 0;
    if (tokens.length > 0) {
      const fetchFn = opts.fetchFn ?? fetch;
      const delivery = await sendExpoPushMessages(
        tokens.map(({ token }) => ({
          to: token,
          title: `${name} posted ${game.title}`,
          body: "You nudged them — see how you compare",
          data: {
            kind: "nudge_answered",
            userId: posterId,
            gameId: game.id,
            url: boardUrl(game.id, periodKey),
          },
          sound: "default" as const,
        })),
        {
          db,
          fetchFn: (input, init) =>
            fetchFn(input, { ...init, signal: AbortSignal.timeout(NUDGE_PUSH_TIMEOUT_MS) }),
        },
      );
      sent = delivery.sent;
    }
    logger.info("nudge answered", {
      recipient_id: posterId,
      game_id: game.id,
      senders: senderIds.length,
      sender_devices: tokens.length,
      sent,
    });
    return senderIds.length;
  } catch (error) {
    logger.error("nudge answer failed", { error, recipient_id: posterId, game_id: game.id });
    return 0;
  }
}

/**
 * What a score post hands back for the one-tap nudge row, plus the answer
 * bookkeeping above. Never throws: a failure here must not fail the post.
 */
export async function afterScorePosted(
  posterId: string,
  game: Pick<DbGame, "id" | "title">,
  periodKey: string,
): Promise<StalledFriendsNudge | null> {
  await recordNudgeAnswers(posterId, game, periodKey);
  try {
    return await loadStalledFriends(posterId, game.id, periodKey);
  } catch (error) {
    logger.error("stalled friends lookup failed", { error, user_id: posterId, game_id: game.id });
    return null;
  }
}
