import type { MemberRole } from "@workshop/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { items, listMembers, lists } from "../db/schema.js";
import { err } from "../lib/response.js";

declare module "hono" {
  interface ContextVariableMap {
    listMemberRole: MemberRole;
    /** Set by `requireItemMember` so handlers don't need to re-fetch the row. */
    itemListId: string;
  }
}

const uuidSchema = z.string().uuid();

/**
 * Asserts the request's `userId` is a member of the list named by the `:id`
 * path param, then stashes their `role` on the context for handlers to read.
 *
 * Returns 404 (not 403) when the requester isn't a member — we don't leak
 * the existence of lists they can't see. Owner-only handlers should layer
 * `requireListOwner` on top.
 *
 * Must run after `requireAuth`.
 */
export const requireListMember: MiddlewareHandler = async (c, next) => {
  const listId = c.req.param("id");
  const parsedId = uuidSchema.safeParse(listId);
  if (!parsedId.success) {
    return err(c, "NOT_FOUND", "list not found");
  }

  const userId = c.get("userId");
  const db = getDb();
  // Join `lists` so an archived list (soft-deleted) reads as "not found" for
  // every member, including the owner. Membership rows are kept so a future
  // unarchive surface can restore visibility — but until then, the list is
  // invisible. Treat as 404 not 403 to avoid leaking existence.
  const [row] = await db
    .select({ role: listMembers.role })
    .from(listMembers)
    .innerJoin(lists, and(eq(lists.id, listMembers.listId), isNull(lists.archivedAt)))
    .where(and(eq(listMembers.listId, parsedId.data), eq(listMembers.userId, userId)))
    .limit(1);

  if (!row) {
    return err(c, "NOT_FOUND", "list not found");
  }

  c.set("listMemberRole", row.role as MemberRole);
  await next();
};

/**
 * Asserts the requester is the list's owner. Layered on top of
 * `requireListMember` so `listMemberRole` is already populated.
 */
export const requireListOwner: MiddlewareHandler = async (c, next) => {
  if (c.get("listMemberRole") !== "owner") {
    return err(c, "FORBIDDEN", "owner only");
  }
  await next();
};

/**
 * Asserts the request's `userId` is a member of the list owning the item
 * named by the `:id` path param. Resolves item → list_id → membership in
 * a single query, then stashes the role + list id on the context.
 *
 * Like `requireListMember`, returns 404 (not 403) when the requester isn't
 * a member or the item doesn't exist — never leaks existence.
 *
 * Must run after `requireAuth`.
 */
export const requireItemMember: MiddlewareHandler = async (c, next) => {
  const itemId = c.req.param("id");
  const parsedId = uuidSchema.safeParse(itemId);
  if (!parsedId.success) {
    return err(c, "NOT_FOUND", "item not found");
  }

  const userId = c.get("userId");
  const db = getDb();
  // Join `lists` so an archived parent list reads as "not found" too — both
  // the item's own `archived_at` and the parent's must be NULL for the item
  // to be reachable.
  const [row] = await db
    .select({ listId: items.listId, role: listMembers.role })
    .from(items)
    .innerJoin(
      listMembers,
      and(eq(listMembers.listId, items.listId), eq(listMembers.userId, userId)),
    )
    .innerJoin(lists, and(eq(lists.id, items.listId), isNull(lists.archivedAt)))
    .where(and(eq(items.id, parsedId.data), isNull(items.archivedAt)))
    .limit(1);

  if (!row) {
    return err(c, "NOT_FOUND", "item not found");
  }

  c.set("listMemberRole", row.role as MemberRole);
  c.set("itemListId", row.listId);
  await next();
};
