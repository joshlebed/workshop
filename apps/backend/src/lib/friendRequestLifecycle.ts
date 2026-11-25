// The directed friend-request lifecycle (onboarding spike #7, docs/friend-request-recovery.md):
//
//   pending ──(48h, recipient has a push token, local daytime)──▶ pending + reminded_at
//   pending ──(expires_at passes)──▶ expired           (gone from the recipient's inbox)
//   pending ──(accept / cross-request / link / vouch)──▶ deleted, friendship formed
//   pending ──(deny / cancel / block)──▶ deleted
//   expired ──(sender re-sends)──▶ deleted + a fresh pending row
//
// Every query that asks "is there a live pending request?" goes through
// `livePendingWhere`, so a row past `expires_at` the job hasn't swept yet
// already reads as gone. Events are written only from here.

import { and, eq, gt, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { friendRequestEvents, friendRequests } from "../db/schema.js";
import { logger } from "./logger.js";
import type { DbClient } from "./sql.js";

/** A still-pending request gets one reminder push this long after it was sent. */
export const FRIEND_REQUEST_REMINDER_AFTER_HOURS = 48;
/** A pending request expires this long after it was sent. */
export const FRIEND_REQUEST_TTL_DAYS = 14;

export type FriendRequestEventKind =
  | "reminded"
  | "accepted"
  | "accepted_after_reminder"
  | "declined_after_reminder"
  | "expired"
  | "resent";

export function friendRequestExpiresAt(now: Date): Date {
  return new Date(now.getTime() + FRIEND_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** `status = 'pending'` and not past `expires_at` (NULL = no expiry recorded). */
export function livePendingWhere(now: Date = new Date()): SQL {
  return and(
    eq(friendRequests.status, "pending"),
    or(isNull(friendRequests.expiresAt), gt(friendRequests.expiresAt, now)),
  ) as SQL;
}

/** Either direction between two users. */
export function directedPairWhere(a: string, b: string): SQL {
  return or(
    and(eq(friendRequests.inviterId, a), eq(friendRequests.inviteeId, b)),
    and(eq(friendRequests.inviterId, b), eq(friendRequests.inviteeId, a)),
  ) as SQL;
}

interface RequestRef {
  inviterId: string;
  inviteeId: string;
  createdAt: Date;
}

export async function recordFriendRequestEvents(
  kind: FriendRequestEventKind,
  requests: RequestRef[],
  db: DbClient = getDb(),
): Promise<void> {
  if (requests.length === 0) return;
  await db.insert(friendRequestEvents).values(
    requests.map((r) => ({
      kind,
      inviterId: r.inviterId,
      inviteeId: r.inviteeId,
      requestCreatedAt: r.createdAt,
    })),
  );
}

/**
 * Delete every directed request between `a` and `b` (pending or expired, both
 * directions) and record how it ended. `accepted`: a friendship formed, so a
 * pending row is `accepted` / `accepted_after_reminder`. `removed`: deny,
 * cancel or block by `actorId`; only the recipient removing a reminded row is
 * worth recording (`declined_after_reminder`) — a sender's cancel isn't an
 * answer. Instrumentation never fails the caller.
 */
export async function consumeDirectedRequests(
  a: string,
  b: string,
  opts: { outcome: "accepted" | "removed"; actorId?: string; db?: DbClient },
): Promise<void> {
  const db = opts.db ?? getDb();
  const removed = await db
    .delete(friendRequests)
    .where(and(inArray(friendRequests.status, ["pending", "expired"]), directedPairWhere(a, b)))
    .returning({
      inviterId: friendRequests.inviterId,
      inviteeId: friendRequests.inviteeId,
      status: friendRequests.status,
      createdAt: friendRequests.createdAt,
      remindedAt: friendRequests.remindedAt,
    });
  const pending = removed.filter(
    (r): r is typeof r & { inviteeId: string } => r.status === "pending" && r.inviteeId !== null,
  );
  if (pending.length === 0) return;
  try {
    if (opts.outcome === "accepted") {
      for (const r of pending) {
        const afterReminder = r.remindedAt !== null;
        await recordFriendRequestEvents(
          afterReminder ? "accepted_after_reminder" : "accepted",
          [r],
          db,
        );
        logger.info("friend request accepted", {
          inviter_id: r.inviterId,
          invitee_id: r.inviteeId,
          after_reminder: afterReminder,
          age_hours: Math.round((Date.now() - r.createdAt.getTime()) / 3_600_000),
        });
      }
    } else {
      const declined = pending.filter((r) => r.remindedAt !== null && r.inviteeId === opts.actorId);
      await recordFriendRequestEvents("declined_after_reminder", declined, db);
    }
  } catch (error) {
    logger.warn("friend request event write failed", { error });
  }
}

/**
 * Before a fresh send: drop the sender's own expired request to the same
 * person and record the re-send. Returns whether there was one.
 */
export async function clearExpiredForResend(
  inviterId: string,
  inviteeId: string,
  db: DbClient = getDb(),
): Promise<boolean> {
  const removed = await db
    .delete(friendRequests)
    .where(
      and(
        // Expired, or pending but past expiry and not yet swept by the job.
        or(
          eq(friendRequests.status, "expired"),
          and(eq(friendRequests.status, "pending"), lte(friendRequests.expiresAt, new Date())),
        ),
        eq(friendRequests.inviterId, inviterId),
        eq(friendRequests.inviteeId, inviteeId),
      ),
    )
    .returning({ createdAt: friendRequests.createdAt });
  const first = removed[0];
  if (!first) return false;
  try {
    await recordFriendRequestEvents(
      "resent",
      [{ inviterId, inviteeId, createdAt: first.createdAt }],
      db,
    );
    logger.info("friend request resent", { inviter_id: inviterId, invitee_id: inviteeId });
  } catch (error) {
    logger.warn("friend request event write failed", { error });
  }
  return true;
}

/** When the viewer's own request to `targetId` expired, or null. */
export async function outboundExpiredAt(
  viewerId: string,
  targetId: string,
  db: DbClient = getDb(),
): Promise<Date | null> {
  const [row] = await db
    .select({ respondedAt: friendRequests.respondedAt, expiresAt: friendRequests.expiresAt })
    .from(friendRequests)
    .where(
      and(
        eq(friendRequests.status, "expired"),
        eq(friendRequests.inviterId, viewerId),
        eq(friendRequests.inviteeId, targetId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return row.respondedAt ?? row.expiresAt ?? new Date();
}
