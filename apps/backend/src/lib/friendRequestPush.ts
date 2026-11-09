// Push the recipient of a fresh directed friend request
// (`POST /v1/friends/requests`) so it doesn't sit unanswered behind the
// operator's Discord ping. Delivery goes through the shared
// `sendExpoPushMessages` (chunking, tickets, `DeviceNotRegistered` pruning,
// `EXPO_PUSH_URL`). Best-effort: `sendFriendRequestPush` never throws and caps
// the Expo round-trip, so a push problem can't fail or stall the request.

import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { pushTokens, users } from "../db/schema.js";
import { type ExpoPushMessage, sendExpoPushMessages } from "./expoPush.js";
import { logger } from "./logger.js";
import type { DbClient } from "./sql.js";

/** Upper bound on the Expo request so a slow push can't hold the response. */
const FRIEND_REQUEST_PUSH_TIMEOUT_MS = 3000;

/** One message per registered device of the request's recipient. */
export function buildFriendRequestPushMessages(
  inviter: { id: string; displayName: string | null },
  tokens: string[],
): ExpoPushMessage[] {
  const name = inviter.displayName?.trim() || "Someone";
  return tokens.map((to) => ({
    to,
    title: "New friend request",
    body: `${name} wants to be friends on HighScore`,
    data: { kind: "friend_request", userId: inviter.id },
    sound: "default",
  }));
}

export async function sendFriendRequestPush(
  inviterId: string,
  targetId: string,
  opts: { db?: DbClient; fetchFn?: typeof fetch } = {},
): Promise<void> {
  try {
    const db = opts.db ?? getDb();
    const [inviterRows, tokenRows] = await Promise.all([
      db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.id, inviterId))
        .limit(1),
      db
        .select({ token: pushTokens.expoPushToken })
        .from(pushTokens)
        .where(eq(pushTokens.userId, targetId))
        .orderBy(pushTokens.expoPushToken),
    ]);
    if (tokenRows.length === 0) return;
    const inviter = inviterRows[0] ?? { id: inviterId, displayName: null };
    const messages = buildFriendRequestPushMessages(
      inviter,
      tokenRows.map((row) => row.token),
    );
    const fetchFn = opts.fetchFn ?? fetch;
    const delivery = await sendExpoPushMessages(messages, {
      db,
      fetchFn: (input, init) =>
        fetchFn(input, { ...init, signal: AbortSignal.timeout(FRIEND_REQUEST_PUSH_TIMEOUT_MS) }),
      onChunkError: (error, chunkIndex, tokenCount) =>
        logger.error("friend request push chunk failed", {
          error,
          chunk_index: chunkIndex,
          token_count: tokenCount,
        }),
    });
    logger.info("friend request push sent", {
      target_id: targetId,
      tokens: messages.length,
      sent: delivery.sent,
      failed: delivery.failed,
      pruned: delivery.prunedTokens.length,
    });
  } catch (error) {
    logger.error("friend request push failed", { error, target_id: targetId });
  }
}
