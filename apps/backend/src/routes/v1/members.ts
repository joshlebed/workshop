import type { ListMemberSummary, MemberRole } from "@workshop/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { listMembers, lists, users } from "../../db/schema.js";
import { recordEvent } from "../../lib/events.js";
import { notifyOwnershipTransferred } from "../../lib/opsNotifications.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireListMember } from "../../middleware/authorize.js";

/**
 * `DELETE /v1/lists/:id/members/:userId`
 *
 * Two flows fold into one handler:
 *
 * - **Owner removes another member**: requester must be the list's
 *   owner; target must not be the owner (owners can only delete the
 *   list).
 * - **Self-leave**: any member with `userId === me` can leave their
 *   own row, except the owner (spec §2.5: "Owner cannot leave, can
 *   delete.").
 *
 * Items the leaver added remain on the list with their `added_by`
 * attribution preserved.
 */
export const memberRoutes = new Hono();

memberRoutes.use("*", requireAuth);

const uuidSchema = z.string().uuid();

memberRoutes.delete("/:id/members/:userId", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  if (!uuidSchema.safeParse(targetUserId).success) {
    return err(c, "NOT_FOUND", "member not found");
  }

  const requesterId = c.get("userId");
  const requesterRole = c.get("listMemberRole");
  const isSelfLeave = requesterId === targetUserId;
  if (!isSelfLeave && requesterRole !== "owner") {
    return err(c, "FORBIDDEN", "owner only");
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: listMembers.role })
      .from(listMembers)
      .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, targetUserId)))
      .limit(1);
    if (!target) return { kind: "not_found" as const };
    if (target.role === "owner") {
      return { kind: "owner_block" as const };
    }

    await tx
      .delete(listMembers)
      .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, targetUserId)));

    // Self-leave vs owner-removal is the same handler but different
    // event types: `member_left` for the actor leaving themselves,
    // `member_removed` when an owner kicks someone else. Payload
    // captures the target so the feed can render "X removed Y".
    await recordEvent({
      db: tx,
      listId,
      actorId: requesterId,
      type: isSelfLeave ? "member_left" : "member_removed",
      payload: { targetUserId },
    });

    return { kind: "ok" as const };
  });

  if (result.kind === "not_found") return err(c, "NOT_FOUND", "member not found");
  if (result.kind === "owner_block") {
    return err(c, "FORBIDDEN", "owner cannot leave; archive the list instead");
  }
  return ok(c, { ok: true });
});

// --- POST /v1/lists/:id/members/:userId/promote (transfer ownership) ---

/**
 * Atomic ownership transfer: demotes the current owner to `member` and
 * promotes the target to `owner` in one transaction. Ordering matters
 * because `list_members_one_owner_idx` enforces exactly one owner row per
 * list, so we drop the existing owner role to NULL via a CASE in a single
 * UPDATE rather than two separate writes that would briefly violate the
 * partial unique index.
 *
 * Only the current owner can initiate; target must already be a member
 * (you can't transfer to a stranger). After this returns, the previous
 * owner becomes a member and can leave or be removed normally — the
 * owner-can't-leave rule fires only when the requester is *still* the
 * only owner.
 */
memberRoutes.post("/:id/members/:userId/promote", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  if (!uuidSchema.safeParse(targetUserId).success) {
    return err(c, "NOT_FOUND", "member not found");
  }

  const requesterId = c.get("userId");
  const requesterRole = c.get("listMemberRole");
  if (requesterRole !== "owner") return err(c, "FORBIDDEN", "owner only");
  if (requesterId === targetUserId) {
    return err(c, "VALIDATION", "you are already the owner");
  }

  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: listMembers.role })
      .from(listMembers)
      .where(and(eq(listMembers.listId, listId), eq(listMembers.userId, targetUserId)))
      .limit(1);
    if (!target) return { kind: "not_found" as const };

    // Single UPDATE with CASE swaps the two roles atomically — keeps the
    // `list_members_one_owner_idx` partial unique invariant satisfied at
    // every moment (no transient two-owner row, no transient zero-owner row).
    await tx.execute(sql`
      UPDATE list_members
      SET role = CASE
        WHEN user_id = ${requesterId}::uuid THEN 'member'::member_role
        WHEN user_id = ${targetUserId}::uuid THEN 'owner'::member_role
        ELSE role
      END
      WHERE list_id = ${listId}::uuid
        AND user_id IN (${requesterId}::uuid, ${targetUserId}::uuid)
    `);

    // Update the list's owner_id mirror column too so the ListSummary view
    // reads the right owner from the lists row directly (avoids a second
    // join through list_members for the per-list owner badge).
    await tx
      .update(lists)
      .set({ ownerId: targetUserId, updatedAt: new Date() })
      .where(eq(lists.id, listId));

    await recordEvent({
      db: tx,
      listId,
      actorId: requesterId,
      type: "owner_transferred",
      payload: { previousOwnerId: requesterId, newOwnerId: targetUserId },
    });

    const rows = await tx
      .select({
        userId: listMembers.userId,
        role: listMembers.role,
        joinedAt: listMembers.joinedAt,
        displayName: users.displayName,
      })
      .from(listMembers)
      .leftJoin(users, eq(users.id, listMembers.userId))
      .where(eq(listMembers.listId, listId));

    return {
      kind: "ok" as const,
      members: rows.map<ListMemberSummary>((m) => ({
        userId: m.userId,
        displayName: m.displayName ?? null,
        role: m.role as MemberRole,
        joinedAt: m.joinedAt.toISOString(),
      })),
    };
  });

  if (result.kind === "not_found") return err(c, "NOT_FOUND", "member not found");
  await notifyOwnershipTransferred(listId, requesterId, targetUserId);
  return ok(c, { members: result.members });
});
