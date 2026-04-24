import type { List, ListColor, ListMemberSummary, ListSummary, MemberRole } from "@workshop/shared";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbList, listMembers, lists, users } from "../../db/schema.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireListMember, requireListOwner } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { createItem, createItemSchema, fetchItemsForList } from "./items.js";

export const listRoutes = new Hono();

listRoutes.use("*", requireAuth);

const listColors = ["sunset", "ocean", "forest", "grape", "rose", "sand", "slate"] as const;
const listTypes = ["movie", "tv", "book", "date_idea", "trip"] as const;

const nameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "name required").max(100, "name too long"))
  .refine((s) => !/[\r\n]/.test(s), "name must be a single line");

const emojiSchema = z
  .string()
  .min(1, "emoji required")
  .max(10, "emoji too long")
  .refine((s) => !/[\r\n]/.test(s), "emoji must be a single line");

const colorSchema = z.enum(listColors);
const typeSchema = z.enum(listTypes);

const descriptionSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(280, "description too long"));

export const createListSchema = z.object({
  type: typeSchema,
  name: nameSchema,
  emoji: emojiSchema,
  color: colorSchema,
  description: descriptionSchema.optional(),
});

export const updateListSchema = z
  .object({
    name: nameSchema.optional(),
    emoji: emojiSchema.optional(),
    color: colorSchema.optional(),
    // null clears, undefined leaves alone, string updates.
    description: z.union([descriptionSchema, z.null()]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

function toListShape(l: DbList): List {
  return {
    id: l.id,
    type: l.type,
    name: l.name,
    emoji: l.emoji,
    color: l.color as ListColor,
    description: l.description,
    ownerId: l.ownerId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

listRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  // One query: every list the user is a member of, plus their role + the
  // member/item counts. Aggregates use COUNT(DISTINCT ...) so the cross-join
  // between members and items doesn't double-count.
  const rows = (await db.execute(sql`
    SELECT
      l.id,
      l.type::text AS type,
      l.name,
      l.emoji,
      l.color,
      l.description,
      l.owner_id,
      l.created_at,
      l.updated_at,
      me.role::text AS my_role,
      (SELECT COUNT(*)::int FROM list_members m WHERE m.list_id = l.id) AS member_count,
      (SELECT COUNT(*)::int FROM items i WHERE i.list_id = l.id) AS item_count
    FROM lists l
    JOIN list_members me ON me.list_id = l.id AND me.user_id = ${userId}
    ORDER BY l.updated_at DESC
  `)) as Array<Record<string, unknown>> | { rows: Array<Record<string, unknown>> };

  const list = Array.isArray(rows) ? rows : rows.rows;
  const summaries: ListSummary[] = list.map((r) => {
    const createdAt = r.created_at instanceof Date ? r.created_at : new Date(String(r.created_at));
    const updatedAt = r.updated_at instanceof Date ? r.updated_at : new Date(String(r.updated_at));
    return {
      id: String(r.id),
      type: String(r.type) as ListSummary["type"],
      name: String(r.name),
      emoji: String(r.emoji),
      color: String(r.color) as ListColor,
      description: r.description === null ? null : String(r.description),
      ownerId: String(r.owner_id),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
      role: String(r.my_role) as MemberRole,
      memberCount: Number(r.member_count),
      itemCount: Number(r.item_count),
    };
  });

  return ok(c, { lists: summaries });
});

listRoutes.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return err(c, "VALIDATION", "invalid json body");
  }
  const parsed = createListSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid request", parsed.error.issues);
  }
  const userId = c.get("userId");
  const db = getDb();

  const created = await db.transaction(async (tx) => {
    const [list] = await tx
      .insert(lists)
      .values({
        type: parsed.data.type,
        name: parsed.data.name,
        emoji: parsed.data.emoji,
        color: parsed.data.color,
        description: parsed.data.description ?? null,
        ownerId: userId,
      })
      .returning();
    if (!list) throw new Error("list insert returned no row");
    await tx.insert(listMembers).values({
      listId: list.id,
      userId,
      role: "owner",
    });
    return list;
  });

  return ok(c, { list: toListShape(created) }, 201);
});

listRoutes.get("/:id", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const db = getDb();
  const [list] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
  if (!list) return err(c, "NOT_FOUND", "list not found");

  const memberRows = await db
    .select({
      userId: listMembers.userId,
      role: listMembers.role,
      joinedAt: listMembers.joinedAt,
      displayName: users.displayName,
    })
    .from(listMembers)
    .leftJoin(users, eq(users.id, listMembers.userId))
    .where(eq(listMembers.listId, listId));

  const members: ListMemberSummary[] = memberRows.map((m) => ({
    userId: m.userId,
    displayName: m.displayName ?? null,
    role: m.role as MemberRole,
    joinedAt: m.joinedAt.toISOString(),
  }));

  return ok(c, {
    list: toListShape(list),
    members,
    pendingInvites: [],
  });
});

listRoutes.patch("/:id", requireListMember, requireListOwner, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return err(c, "VALIDATION", "invalid json body");
  }
  const parsed = updateListSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid request", parsed.error.issues);
  }
  const listId = c.req.param("id");
  const db = getDb();

  const patch: Partial<DbList> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.emoji !== undefined) patch.emoji = parsed.data.emoji;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  if (parsed.data.description !== undefined) {
    patch.description = parsed.data.description;
  }

  const [updated] = await db.update(lists).set(patch).where(eq(lists.id, listId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "list not found");
  return ok(c, { list: toListShape(updated) });
});

listRoutes.delete("/:id", requireListMember, requireListOwner, async (c) => {
  const listId = c.req.param("id");
  const db = getDb();
  // ON DELETE CASCADE on items / list_members / item_upvotes / activity_events
  // / list_invites / user_activity_reads handles the dependents.
  const deleted = await db.delete(lists).where(eq(lists.id, listId)).returning({ id: lists.id });
  if (deleted.length === 0) return err(c, "NOT_FOUND", "list not found");
  return ok(c, { ok: true });
});

// --- List-scoped item routes (Phase 1a-2) ---
//
// Mounted under `/v1/lists/:id/items`. The item-id-scoped routes
// (`/v1/items/:id/...`) live in `items.ts` and ship under their own router.

const completedFilter = z
  .union([z.literal("true"), z.literal("false")])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

listRoutes.get("/:id/items", requireListMember, async (c) => {
  const completedParam = completedFilter.safeParse(c.req.query("completed"));
  if (!completedParam.success) {
    return err(c, "VALIDATION", "invalid completed filter");
  }
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const items = await fetchItemsForList(listId, userId, { completed: completedParam.data });
  return ok(c, { items });
});

listRoutes.post(
  "/:id/items",
  requireListMember,
  rateLimit({
    family: "v1.items.create",
    limit: 60,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return err(c, "VALIDATION", "invalid json body");
    }
    const parsed = createItemSchema.safeParse(body);
    if (!parsed.success) {
      return err(c, "VALIDATION", "invalid request", parsed.error.issues);
    }
    const listId = c.req.param("id");
    const userId = c.get("userId");
    const item = await createItem(listId, userId, parsed.data);
    return ok(c, { item }, 201);
  },
);
