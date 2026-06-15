import type { MemberRole, SavedView, SavedViewConfig } from "@workshop/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbListSavedView, listSavedViews } from "../../db/schema.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireListMember } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";

/**
 * Saved views (spec §2.3) — named, stored tag filters on a list. A view is a
 * one-tap preset ("Burgers" inside "Date Ideas"); the rows are **shared by
 * every list member**, not per-viewer. Mounted at `/v1/lists` alongside the
 * other list-scoped sub-routers (members, scores), so the routes are
 * `/v1/lists/:id/views[/:viewId]` and `requireListMember` reads the list `:id`.
 *
 * Permissions: any member creates (membership is the only gate); the view's
 * creator or the list owner edits/removes it (the issue's "creator or list
 * owner deletes" rule, extended to edits — both mutate a shared resource).
 */
export const listViewRoutes = new Hono();

listViewRoutes.use("*", requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Short label for the view. Trim, single line, 1–60 chars.
const nameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "name required").max(60, "name too long"))
  .refine((s) => !/[\r\n]/.test(s), "name must be a single line");

// Tags inside a view config mirror item-tag normalization (see `tagSchema` in
// items.ts): trim, lowercase, collapse internal whitespace, 1–40 chars. The
// set is deduped + sorted so a stored view's tags are canonical and directly
// comparable to the live filter-chip selection on the client.
const tagSchema = z
  .string()
  .transform((s) => s.trim().toLowerCase().replace(/\s+/g, " "))
  .pipe(z.string().min(1, "tag required").max(40, "tag too long"));

// Reserved for a future sort control; round-tripped untouched today.
const sortSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "sort required").max(40, "sort too long"));

const configSchema = z
  .object({
    tags: z.array(tagSchema).max(20, "too many tags"),
    sort: sortSchema.optional(),
  })
  .transform((v) => {
    const tags = [...new Set(v.tags)].sort();
    return v.sort ? { tags, sort: v.sort } : { tags };
  });

const createViewSchema = z.object({
  name: nameSchema,
  config: configSchema,
});

const updateViewSchema = z
  .object({
    name: nameSchema.optional(),
    config: configSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

export const __test = {
  createViewSchema,
  updateViewSchema,
  configSchema,
  nameSchema,
};

function toViewShape(v: DbListSavedView): SavedView {
  const raw = (v.config ?? {}) as Partial<SavedViewConfig>;
  const config: SavedViewConfig = {
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    ...(typeof raw.sort === "string" ? { sort: raw.sort } : {}),
  };
  return {
    id: v.id,
    listId: v.listId,
    name: v.name,
    config,
    createdBy: v.createdBy ?? null,
    position: v.position ?? null,
    createdAt: v.createdAt.toISOString(),
  };
}

/**
 * A view's creator or the list owner may edit/remove it. Members who didn't
 * author a view can still create their own; they just can't mutate someone
 * else's. The owner can manage every view on the list.
 */
function canMutateView(
  view: { createdBy: string | null },
  userId: string,
  role: MemberRole,
): boolean {
  return role === "owner" || view.createdBy === userId;
}

const viewWriteRateLimit = rateLimit({
  family: "v1.views.write",
  limit: 60,
  windowSec: 60,
  key: (c) => c.get("userId") ?? null,
});

// --- GET /v1/lists/:id/views ---

listViewRoutes.get("/:id/views", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const db = getDb();
  const rows = await db
    .select()
    .from(listSavedViews)
    .where(eq(listSavedViews.listId, listId))
    // Display order: explicit position first (creation order today), then
    // created_at as a stable tiebreaker for any null-position legacy rows.
    .orderBy(sql`${listSavedViews.position} ASC NULLS LAST`, sql`${listSavedViews.createdAt} ASC`);
  return ok(c, { views: rows.map(toViewShape) });
});

// --- POST /v1/lists/:id/views (any member) ---

listViewRoutes.post("/:id/views", requireListMember, viewWriteRateLimit, async (c) => {
  const parsed = await parseJsonBody(c, createViewSchema);
  if (!parsed.ok) return parsed.response;
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const db = getDb();

  // Append to the end of the strip: max(position) + 1, starting at 0.
  const [maxRow] = await db
    .select({ max: sql<number | null>`max(${listSavedViews.position})` })
    .from(listSavedViews)
    .where(eq(listSavedViews.listId, listId));
  const maxPos = maxRow?.max;
  const nextPosition = maxPos === null || maxPos === undefined ? 0 : Number(maxPos) + 1;

  const [row] = await db
    .insert(listSavedViews)
    .values({
      listId,
      name: parsed.data.name,
      config: parsed.data.config,
      createdBy: userId,
      position: nextPosition,
    })
    .returning();
  if (!row) return err(c, "INTERNAL", "view insert returned no row");
  return ok(c, { view: toViewShape(row) }, 201);
});

// --- PATCH /v1/lists/:id/views/:viewId (creator or owner) ---

listViewRoutes.patch("/:id/views/:viewId", requireListMember, viewWriteRateLimit, async (c) => {
  const viewId = c.req.param("viewId");
  if (!UUID_RE.test(viewId)) return err(c, "NOT_FOUND", "view not found");
  const parsed = await parseJsonBody(c, updateViewSchema);
  if (!parsed.ok) return parsed.response;
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const role = c.get("listMemberRole");
  const db = getDb();

  const [existing] = await db
    .select()
    .from(listSavedViews)
    .where(and(eq(listSavedViews.id, viewId), eq(listSavedViews.listId, listId)))
    .limit(1);
  if (!existing) return err(c, "NOT_FOUND", "view not found");
  if (!canMutateView(existing, userId, role)) {
    return err(c, "FORBIDDEN", "permission_denied", { reason: "view_creator_or_owner_only" });
  }

  const patch: Partial<DbListSavedView> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.config !== undefined) patch.config = parsed.data.config;

  const [updated] = await db
    .update(listSavedViews)
    .set(patch)
    .where(eq(listSavedViews.id, viewId))
    .returning();
  if (!updated) return err(c, "NOT_FOUND", "view not found");
  return ok(c, { view: toViewShape(updated) });
});

// --- DELETE /v1/lists/:id/views/:viewId (creator or owner) ---

listViewRoutes.delete("/:id/views/:viewId", requireListMember, viewWriteRateLimit, async (c) => {
  const viewId = c.req.param("viewId");
  if (!UUID_RE.test(viewId)) return err(c, "NOT_FOUND", "view not found");
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const role = c.get("listMemberRole");
  const db = getDb();

  const [existing] = await db
    .select()
    .from(listSavedViews)
    .where(and(eq(listSavedViews.id, viewId), eq(listSavedViews.listId, listId)))
    .limit(1);
  if (!existing) return err(c, "NOT_FOUND", "view not found");
  if (!canMutateView(existing, userId, role)) {
    return err(c, "FORBIDDEN", "permission_denied", { reason: "view_creator_or_owner_only" });
  }

  await db.delete(listSavedViews).where(eq(listSavedViews.id, viewId));
  return ok(c, { ok: true });
});
