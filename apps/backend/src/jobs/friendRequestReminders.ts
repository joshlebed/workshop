// Pending friend-request recovery (onboarding spike #7, docs/friend-request-recovery.md).
// Two passes over directed `friend_requests` rows, run on the database wake the
// six-hourly `request-rollups` invocation already pays for (lambda.ts), and on
// demand as `{ "job": "friend-request-reminders" }`:
//
// 1. Expire: a pending row past `expires_at` becomes `status = 'expired'`,
//    `responded_at = now`. It leaves the recipient's inbox; the sender's
//    profile view offers "send again". Silent — no push.
// 2. Remind: a pending row at least 48h old with no `reminded_at` gets one
//    push to the recipient, grouped per recipient ("Sam and 2 others want to
//    be friends"), only while it is 9:00–20:59 in the recipient's canonical
//    timezone (latest push token, same rule as play reminders). A recipient
//    with no push token gets no push and stays un-reminded; the in-app badge,
//    inbox and home card are their reminder. Same pattern as
//    jobs/playReminders.ts: one query, `sendExpoPushMessages`, mark on any
//    answered ticket.

import { and, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { withDbRetry } from "../db/retry.js";
import { friendRequests, pushTokens, users } from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { type ExpoPushMessage, sendExpoPushMessages } from "../lib/expoPush.js";
import {
  FRIEND_REQUEST_REMINDER_AFTER_HOURS,
  FRIEND_REQUEST_TTL_DAYS,
  recordFriendRequestEvents,
} from "../lib/friendRequestLifecycle.js";
import { logger } from "../lib/logger.js";
import { type DbClient, executeRows } from "../lib/sql.js";

/** Local hours (recipient's timezone) a reminder may go out: [start, end). */
const FRIEND_REMINDER_LOCAL_HOURS = { start: 9, end: 21 } as const;

/** Where a tapped reminder lands (HighScore's `notificationPath`). */
const FRIEND_REQUESTS_URL = "highscore:///friends";

interface DueRow {
  requestId: string;
  inviterId: string;
  inviteeId: string;
  inviterName: string | null;
  createdAt: Date | string;
  localHour: number | string;
}

interface FriendRequestReminderJobResult {
  expired: number;
  due: number;
  outsideHours: number;
  recipients: number;
  reminded: number;
  sent: number;
  pruned: number;
}

/** "Sam wants to be friends" / "Sam and 2 others want to be friends". */
export function friendReminderBody(names: Array<string | null>): string {
  const first = names[0]?.trim() || "Someone";
  const others = names.length - 1;
  if (others <= 0) return `${first} wants to be friends on HighScore`;
  return `${first} and ${others} ${others === 1 ? "other" : "others"} want to be friends on HighScore`;
}

export function buildFriendReminderMessages(
  inviters: Array<{ id: string; displayName: string | null }>,
  tokens: string[],
): ExpoPushMessage[] {
  const body = friendReminderBody(inviters.map((i) => i.displayName));
  return tokens.map((to) => ({
    to,
    title: "Friend request waiting",
    body,
    data: {
      kind: "friend_request_reminder",
      userId: inviters[0]?.id ?? null,
      url: FRIEND_REQUESTS_URL,
    },
    sound: "default",
  }));
}

async function expireDue(db: DbClient, now: Date) {
  return db
    .update(friendRequests)
    .set({ status: "expired", respondedAt: now })
    .where(
      and(
        isNotNull(friendRequests.inviteeId),
        sql`${friendRequests.status} = 'pending'`,
        or(
          lte(friendRequests.expiresAt, now),
          // A row with no expiry recorded (shouldn't exist after 0066) falls
          // back to created_at + TTL.
          and(
            sql`${friendRequests.expiresAt} IS NULL`,
            lte(
              friendRequests.createdAt,
              new Date(now.getTime() - FRIEND_REQUEST_TTL_DAYS * 24 * 3_600_000),
            ),
          ),
        ),
      ),
    )
    .returning({
      inviterId: friendRequests.inviterId,
      inviteeId: friendRequests.inviteeId,
      createdAt: friendRequests.createdAt,
    });
}

async function selectDue(db: DbClient, now: Date): Promise<DueRow[]> {
  const nowIso = now.toISOString();
  const cutoff = new Date(
    now.getTime() - FRIEND_REQUEST_REMINDER_AFTER_HOURS * 3_600_000,
  ).toISOString();
  return executeRows<DueRow>(
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
      )
      SELECT
        fr.id AS "requestId",
        fr.inviter_id AS "inviterId",
        fr.invitee_id AS "inviteeId",
        inviter.display_name AS "inviterName",
        fr.created_at AS "createdAt",
        EXTRACT(HOUR FROM ${nowIso}::timestamptz AT TIME ZONE canonical.timezone)::int AS "localHour"
      FROM ${friendRequests} fr
      INNER JOIN canonical_timezones canonical ON canonical.user_id = fr.invitee_id
      INNER JOIN ${users} inviter ON inviter.id = fr.inviter_id
      WHERE fr.invitee_id IS NOT NULL
        AND fr.status = 'pending'
        AND fr.reminded_at IS NULL
        AND fr.created_at <= ${cutoff}::timestamptz
        AND (fr.expires_at IS NULL OR fr.expires_at > ${nowIso}::timestamptz)
      ORDER BY fr.invitee_id, fr.created_at DESC, fr.id
    `,
  );
}

export async function runFriendRequestReminderJob(
  args: { db?: DbClient; now?: Date; fetchFn?: typeof fetch } = {},
): Promise<FriendRequestReminderJobResult> {
  const config = getConfig();
  const result: FriendRequestReminderJobResult = {
    expired: 0,
    due: 0,
    outsideHours: 0,
    recipients: 0,
    reminded: 0,
    sent: 0,
    pruned: 0,
  };
  if (!config.isLocal && !config.gamesEnabled) {
    logger.info("friend request reminder job complete", { ...result });
    return result;
  }
  const db = args.db ?? getDb();
  const now = args.now ?? new Date();
  const fetchFn = args.fetchFn ?? fetch;

  // 1. Expire.
  const expired = await withDbRetry(() => expireDue(db, now), {
    label: "friend-request-expiry",
  });
  result.expired = expired.length;
  const expiredRefs = expired.flatMap((r) =>
    r.inviteeId ? [{ inviterId: r.inviterId, inviteeId: r.inviteeId, createdAt: r.createdAt }] : [],
  );
  await recordFriendRequestEvents("expired", expiredRefs, db);
  for (const r of expiredRefs) {
    logger.info("friend request expired", { inviter_id: r.inviterId, invitee_id: r.inviteeId });
  }

  // 2. Remind.
  const dueRows = await selectDue(db, now);
  result.due = dueRows.length;
  const inHours = dueRows.filter((r) => {
    const h = Number(r.localHour);
    return h >= FRIEND_REMINDER_LOCAL_HOURS.start && h < FRIEND_REMINDER_LOCAL_HOURS.end;
  });
  result.outsideHours = dueRows.length - inHours.length;
  const byRecipient = new Map<string, DueRow[]>();
  for (const row of inHours) {
    const list = byRecipient.get(row.inviteeId) ?? [];
    list.push(row);
    byRecipient.set(row.inviteeId, list);
  }
  result.recipients = byRecipient.size;
  if (byRecipient.size === 0) {
    logger.info("friend request reminder job complete", { ...result });
    return result;
  }

  const tokenRows = await db
    .select({ userId: pushTokens.userId, token: pushTokens.expoPushToken })
    .from(pushTokens)
    .where(inArray(pushTokens.userId, [...byRecipient.keys()]))
    .orderBy(pushTokens.userId, pushTokens.expoPushToken);
  const messages: ExpoPushMessage[] = [];
  const recipientOfMessage: string[] = [];
  for (const [recipientId, rows] of byRecipient) {
    const tokens = tokenRows.filter((t) => t.userId === recipientId).map((t) => t.token);
    const inviters = rows.map((r) => ({ id: r.inviterId, displayName: r.inviterName }));
    for (const message of buildFriendReminderMessages(inviters, tokens)) {
      messages.push(message);
      recipientOfMessage.push(recipientId);
    }
  }

  const delivery = await sendExpoPushMessages(messages, {
    db,
    fetchFn,
    onChunkError: (error, chunkIndex, tokenCount) =>
      logger.error("friend request reminder push chunk failed", {
        error,
        chunk_index: chunkIndex,
        token_count: tokenCount,
      }),
  });
  const reminded = new Set<string>();
  for (const [index, outcome] of delivery.outcomes.entries()) {
    if (outcome.status === "request_failed") continue;
    result.sent++;
    const recipientId = recipientOfMessage[index];
    if (recipientId) reminded.add(recipientId);
  }
  result.pruned = delivery.prunedTokens.length;

  const remindedRows = [...reminded].flatMap((id) => byRecipient.get(id) ?? []);
  if (remindedRows.length > 0) {
    await db
      .update(friendRequests)
      .set({ remindedAt: now })
      .where(
        inArray(
          friendRequests.id,
          remindedRows.map((r) => r.requestId),
        ),
      );
    await recordFriendRequestEvents(
      "reminded",
      remindedRows.map((r) => ({
        inviterId: r.inviterId,
        inviteeId: r.inviteeId,
        createdAt: new Date(r.createdAt),
      })),
      db,
    );
    for (const r of remindedRows) {
      logger.info("friend request reminder sent", {
        inviter_id: r.inviterId,
        invitee_id: r.inviteeId,
      });
    }
  }
  result.reminded = remindedRows.length;
  if (messages.length > 0 && result.sent === 0) {
    logger.error("job failed", {
      job: "friend-request-reminders",
      reason: "no push request succeeded",
    });
  }
  logger.info("friend request reminder job complete", { ...result });
  return result;
}
