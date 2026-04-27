import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { listMembers } from "../../db/schema.js";
import { recordEvent } from "../../lib/events.js";
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
 * Per spec §2.5, removing a member drops their `item_upvotes` rows
 * scoped to the items in this list, but items they added remain with
 * `added_by` attribution preserved. We do both inside a single tx.
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

    await tx.execute(sql`
      DELETE FROM item_upvotes
      WHERE user_id = ${targetUserId}
        AND item_id IN (SELECT id FROM items WHERE list_id = ${listId})
    `);

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
    return err(c, "FORBIDDEN", "owner cannot leave; delete the list instead");
  }
  return ok(c, { ok: true });
});
