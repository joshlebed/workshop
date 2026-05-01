import type { Item, ItemMetadata, ListType } from "@workshop/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type ZodType, z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbItem, items, itemUpvotes, lists } from "../../db/schema.js";
import { toIsoOrNull, toIsoString } from "../../lib/dates.js";
import { recordEvent } from "../../lib/events.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { executeRows } from "../../lib/sql.js";
import {
  albumShelfItemMetadataSchema,
  albumShelfItemPatchSchema,
} from "../../lib/validators/album-shelf.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireItemMember } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const itemRoutes = new Hono();

itemRoutes.use("*", requireAuth);

// --- Validation ---

const titleSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1, "title required").max(500, "title too long"))
  .refine((s) => !/[\r\n]/.test(s), "title must be a single line");

const urlSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(2048, "url too long"));

const noteSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(1000, "note too long"));

// Loose at parse time — the parent list's `type` is only known after a DB
// lookup, so per-type tightening (spec §9.4) happens in `validateMetadata`
// before persistence.
const metadataSchema = z.record(z.string(), z.unknown());

export const createItemSchema = z.object({
  title: titleSchema,
  url: urlSchema.optional(),
  note: noteSchema.optional(),
  metadata: metadataSchema.optional(),
});

export const updateItemSchema = z
  .object({
    title: titleSchema.optional(),
    url: z.union([urlSchema, z.null()]).optional(),
    note: z.union([noteSchema, z.null()]).optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

// --- Per-type metadata validators (Phase 2a-1, spec §9.4) ---
//
// Every field is optional so manual entries (no provider match) and
// provider-enriched entries share the same JSONB shape. `.strict()` rejects
// stray fields so a stale client can't smuggle arbitrary keys past the
// validator.

const movieTvMetadataSchema = z
  .object({
    source: z.union([z.literal("tmdb"), z.literal("manual")]).optional(),
    sourceId: z.string().max(64).optional(),
    posterUrl: z.string().max(2048).optional(),
    year: z.number().int().min(1800).max(2200).optional(),
    runtimeMinutes: z.number().int().min(0).max(10000).optional(),
    overview: z.string().max(4000).optional(),
  })
  .strict();

const bookMetadataSchema = z
  .object({
    source: z.union([z.literal("google_books"), z.literal("manual")]).optional(),
    sourceId: z.string().max(64).optional(),
    coverUrl: z.string().max(2048).optional(),
    authors: z.array(z.string().max(200)).max(20).optional(),
    year: z.number().int().min(0).max(2200).optional(),
    pageCount: z.number().int().min(0).max(100000).optional(),
    description: z.string().max(4000).optional(),
  })
  .strict();

// `date_idea` and `trip` stay loose-but-shaped: link-preview lands in 2a-2 so
// the spec §9.4 fields are sketched here and tightened in that chunk.
const placeMetadataSchema = z
  .object({
    source: z.union([z.literal("link_preview"), z.literal("manual")]).optional(),
    sourceId: z.string().max(128).optional(),
    image: z.string().max(2048).optional(),
    siteName: z.string().max(200).optional(),
    title: z.string().max(500).optional(),
    description: z.string().max(2000).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict();

const metadataSchemasByType: Record<ListType, ZodType<ItemMetadata>> = {
  movie: movieTvMetadataSchema as ZodType<ItemMetadata>,
  tv: movieTvMetadataSchema as ZodType<ItemMetadata>,
  book: bookMetadataSchema as ZodType<ItemMetadata>,
  date_idea: placeMetadataSchema as ZodType<ItemMetadata>,
  trip: placeMetadataSchema as ZodType<ItemMetadata>,
  album_shelf: albumShelfItemMetadataSchema as ZodType<ItemMetadata>,
};

/**
 * Whitelist of metadata fields a member can mutate on an existing item via
 * `PATCH /v1/items/:id`. For `album_shelf` rows only `position` is mutable;
 * everything else is derived from Spotify and re-set by the refresh path.
 * For other list types we don't currently restrict client patches (manual
 * entries are still free-form), so the validator is a no-op pass-through.
 */
function validatePatchMetadataForType(
  type: ListType,
  metadata: unknown,
): { success: true; data: ItemMetadata } | { success: false; issues: z.ZodIssue[] } {
  if (type === "album_shelf") {
    const r = albumShelfItemPatchSchema.safeParse(metadata);
    if (!r.success) return { success: false, issues: r.error.issues };
    return { success: true, data: r.data as ItemMetadata };
  }
  return validateMetadataForType(type, metadata);
}

/**
 * Per-list-type validation for `items.metadata`. Returns the parsed metadata
 * on success or a Zod error to forward through the v1 envelope.
 */
export function validateMetadataForType(
  type: ListType,
  metadata: unknown,
): { success: true; data: ItemMetadata } | { success: false; issues: z.ZodIssue[] } {
  const schema = metadataSchemasByType[type];
  const r = schema.safeParse(metadata);
  if (!r.success) return { success: false, issues: r.error.issues };
  return { success: true, data: r.data };
}

// --- Shape helpers ---

interface ItemAggregates {
  upvoteCount: number;
  hasUpvoted: boolean;
}

function toItemShape(i: DbItem, agg: ItemAggregates): Item {
  return {
    id: i.id,
    listId: i.listId,
    type: i.type,
    title: i.title,
    url: i.url,
    note: i.note,
    metadata: (i.metadata ?? {}) as ItemMetadata,
    addedBy: i.addedBy,
    completed: i.completed,
    completedAt: i.completedAt ? i.completedAt.toISOString() : null,
    completedBy: i.completedBy,
    upvoteCount: agg.upvoteCount,
    hasUpvoted: agg.hasUpvoted,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

/**
 * Re-selects an item joined with its upvote aggregates. Returns null if the
 * row no longer exists (concurrent delete). Cheaper than re-fetching after
 * every mutation, but easier to reason about than maintaining the aggregate
 * in `RETURNING` clauses.
 */
async function fetchItemShape(itemId: string, userId: string): Promise<Item | null> {
  const db = getDb();
  const [row] = await db
    .select({
      item: items,
      upvoteCount: sql<number>`(SELECT COUNT(*)::int FROM ${itemUpvotes} WHERE ${itemUpvotes.itemId} = ${items.id})`,
      hasUpvoted: sql<boolean>`EXISTS (SELECT 1 FROM ${itemUpvotes} WHERE ${itemUpvotes.itemId} = ${items.id} AND ${itemUpvotes.userId} = ${userId})`,
    })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  if (!row) return null;
  return toItemShape(row.item, { upvoteCount: row.upvoteCount, hasUpvoted: row.hasUpvoted });
}

/**
 * Lists items for a given list, with `upvote_count` aggregated and per-user
 * `has_upvoted`. Sorted per spec §7.7: `upvote_count DESC, created_at DESC`
 * for active items; completed-only filter sorts by `completed_at DESC` per
 * spec §2.4.
 */
export async function fetchItemsForList(
  listId: string,
  userId: string,
  filter: { completed: boolean | undefined },
): Promise<Item[]> {
  const db = getDb();
  const completedClause =
    filter.completed === undefined
      ? sql``
      : filter.completed
        ? sql`AND i.completed = TRUE`
        : sql`AND i.completed = FALSE`;
  // Completed-only requests sort by completed_at DESC; everything else by
  // (upvote_count, created_at).
  const orderBy =
    filter.completed === true
      ? sql`ORDER BY i.completed_at DESC NULLS LAST, i.created_at DESC`
      : sql`ORDER BY upvote_count DESC, i.created_at DESC`;

  const rows = await executeRows<{
    id: string;
    list_id: string;
    type: string;
    title: string;
    url: string | null;
    note: string | null;
    metadata: Record<string, unknown> | null;
    added_by: string;
    completed: boolean;
    completed_at: Date | string | null;
    completed_by: string | null;
    created_at: Date | string;
    updated_at: Date | string;
    upvote_count: number;
    has_upvoted: boolean;
  }>(
    db,
    sql`
      SELECT
        i.id,
        i.list_id,
        i.type::text AS type,
        i.title,
        i.url,
        i.note,
        i.metadata,
        i.added_by,
        i.completed,
        i.completed_at,
        i.completed_by,
        i.created_at,
        i.updated_at,
        COALESCE(u.upvote_count, 0)::int AS upvote_count,
        COALESCE(u.has_upvoted, FALSE) AS has_upvoted
      FROM items i
      LEFT JOIN (
        SELECT
          item_id,
          COUNT(*)::int AS upvote_count,
          BOOL_OR(user_id = ${userId}) AS has_upvoted
        FROM item_upvotes
        GROUP BY item_id
      ) u ON u.item_id = i.id
      WHERE i.list_id = ${listId} ${completedClause}
      ${orderBy}
    `,
  );

  return rows.map((r) => ({
    id: r.id,
    listId: r.list_id,
    type: r.type as ListType,
    title: r.title,
    url: r.url,
    note: r.note,
    metadata: (r.metadata ?? {}) as ItemMetadata,
    addedBy: r.added_by,
    completed: Boolean(r.completed),
    completedAt: toIsoOrNull(r.completed_at),
    completedBy: r.completed_by,
    upvoteCount: Number(r.upvote_count),
    hasUpvoted: Boolean(r.has_upvoted),
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
  }));
}

/** Thrown by `createItem` when per-type metadata validation fails. */
export class ItemMetadataError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    super("invalid metadata for list type");
    this.name = "ItemMetadataError";
    this.issues = issues;
  }
}

/**
 * Inserts an item plus the creator's upvote in a single transaction (spec
 * §2.3). Looks up the parent list's `type` first so the denormalized
 * `items.type` matches `lists.type` per schema §7.6, and so per-type
 * metadata validation (spec §9.4) runs against the right shape.
 */
export async function createItem(
  listId: string,
  userId: string,
  data: z.infer<typeof createItemSchema>,
): Promise<Item> {
  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ type: lists.type })
      .from(lists)
      .where(eq(lists.id, listId))
      .limit(1);
    if (!parent) throw new Error("list missing during item insert");

    let metadata: ItemMetadata = {};
    if (data.metadata !== undefined) {
      const v = validateMetadataForType(parent.type, data.metadata);
      if (!v.success) throw new ItemMetadataError(v.issues);
      metadata = v.data;
    }

    const [row] = await tx
      .insert(items)
      .values({
        listId,
        type: parent.type,
        title: data.title,
        url: data.url ?? null,
        note: data.note ?? null,
        metadata,
        addedBy: userId,
      })
      .returning();
    if (!row) throw new Error("item insert returned no row");

    await tx.insert(itemUpvotes).values({ itemId: row.id, userId });
    // Auto-upvote is an implementation detail of item creation, not a
    // user-visible action — emit `item_added` only.
    await recordEvent({
      db: tx,
      listId,
      actorId: userId,
      type: "item_added",
      itemId: row.id,
      payload: { title: row.title, type: row.type },
    });
    return row;
  });

  return toItemShape(created, { upvoteCount: 1, hasUpvoted: true });
}

// --- Item-id-scoped handlers (mounted at /v1/items) ---

itemRoutes.get("/:id", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const item = await fetchItemShape(itemId, userId);
  if (!item) return err(c, "NOT_FOUND", "item not found");
  return ok(c, { item });
});

itemRoutes.patch("/:id", requireItemMember, async (c) => {
  const parsed = await parseJsonBody(c, updateItemSchema);
  if (!parsed.ok) return parsed.response;

  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const db = getDb();

  const patch: Partial<DbItem> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.url !== undefined) patch.url = parsed.data.url;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;

  // For album_shelf, we need the existing metadata + type to merge a position
  // patch and emit promote/demote events. For other list types, the patch
  // shape replaces the metadata blob wholesale (existing behavior).
  let prevType: ListType | null = null;
  let prevMetadata: ItemMetadata | null = null;
  if (parsed.data.metadata !== undefined) {
    const [existing] = await db
      .select({ type: items.type, metadata: items.metadata })
      .from(items)
      .where(eq(items.id, itemId))
      .limit(1);
    if (!existing) return err(c, "NOT_FOUND", "item not found");
    prevType = existing.type;
    prevMetadata = (existing.metadata ?? {}) as ItemMetadata;

    const v = validatePatchMetadataForType(prevType, parsed.data.metadata);
    if (!v.success) {
      return err(c, "VALIDATION", "invalid metadata for list type", v.issues);
    }

    if (prevType === "album_shelf") {
      // album_shelf: merge `position` into the existing blob. Other fields
      // are immutable client-side.
      const merged = { ...prevMetadata, ...v.data };
      patch.metadata = merged;
    } else {
      patch.metadata = v.data;
    }
  }

  const [updated] = await db.update(items).set(patch).where(eq(items.id, itemId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "item not found");

  // Choose the activity event for this patch. For album_shelf, position
  // changes that cross the divider fire promote/demote; pure within-section
  // reorders (number → number) stay silent to keep the feed quiet. For
  // other list types we always emit `item_updated`.
  const eventToRecord = pickPatchEvent({
    prevType,
    prevMetadata,
    nextMetadata: patch.metadata as ItemMetadata | undefined,
    metadataPatched: parsed.data.metadata !== undefined,
    title: updated.title,
  });
  if (eventToRecord) {
    await recordEvent({
      listId: updated.listId,
      actorId: userId,
      type: eventToRecord.type,
      itemId: updated.id,
      payload: eventToRecord.payload,
    });
  }

  const item = await fetchItemShape(itemId, userId);
  if (!item) return err(c, "NOT_FOUND", "item not found");
  return ok(c, { item });
});

interface PickPatchEventArgs {
  prevType: ListType | null;
  prevMetadata: ItemMetadata | null;
  nextMetadata: ItemMetadata | undefined;
  metadataPatched: boolean;
  title: string;
}

function pickPatchEvent(a: PickPatchEventArgs): {
  type: "item_updated" | "album_promoted" | "album_demoted";
  payload: Record<string, unknown>;
} | null {
  if (a.prevType !== "album_shelf" || !a.metadataPatched) {
    return { type: "item_updated", payload: { title: a.title } };
  }
  const prevPos = (a.prevMetadata as Record<string, unknown> | null)?.position;
  const nextPos = (a.nextMetadata as Record<string, unknown> | undefined)?.position;
  const wasOrdered = typeof prevPos === "number";
  const nowOrdered = typeof nextPos === "number";
  if (!wasOrdered && nowOrdered) {
    return { type: "album_promoted", payload: { albumTitle: a.title, position: nextPos } };
  }
  if (wasOrdered && !nowOrdered) {
    return { type: "album_demoted", payload: { albumTitle: a.title } };
  }
  // Within-section reorder, or a no-op — stay silent.
  return null;
}

itemRoutes.delete("/:id", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const listId = c.get("itemListId");
  const db = getDb();
  // ON DELETE CASCADE on item_upvotes / activity_events handles dependents
  // (including this very event row's `item_id` pointer — recording it
  // before the delete keeps `item_id` populated for the brief window
  // before the cascade fires).
  const [deleted] = await db
    .delete(items)
    .where(eq(items.id, itemId))
    .returning({ id: items.id, title: items.title });
  if (!deleted) return err(c, "NOT_FOUND", "item not found");

  // `item_id` is intentionally null — the row is gone by the time this
  // event is read, and the FK is `ON DELETE CASCADE` so a non-null
  // pointer would cascade-delete this very event row on the next
  // delete pass.
  await recordEvent({
    listId,
    actorId: userId,
    type: "item_deleted",
    payload: { title: deleted.title },
  });
  return ok(c, { ok: true });
});

itemRoutes.post(
  "/:id/upvote",
  requireItemMember,
  rateLimit({
    family: "v1.items.upvote",
    limit: 120,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const itemId = c.req.param("id");
    const userId = c.get("userId");
    const listId = c.get("itemListId");
    const db = getDb();

    // Idempotent: ON CONFLICT DO NOTHING means a second upvote is a no-op.
    // `RETURNING` only emits a row on a fresh insert — a conflict returns
    // nothing — so we use the row count to decide whether to record an
    // event (don't spam the feed on repeat clicks).
    const insertedRows = await executeRows(
      db,
      sql`
        INSERT INTO item_upvotes (item_id, user_id)
        VALUES (${itemId}, ${userId})
        ON CONFLICT (item_id, user_id) DO NOTHING
        RETURNING item_id
      `,
    );

    if (insertedRows.length > 0) {
      await recordEvent({
        listId,
        actorId: userId,
        type: "item_upvoted",
        itemId,
      });
    }

    const item = await fetchItemShape(itemId, userId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);

itemRoutes.delete(
  "/:id/upvote",
  requireItemMember,
  rateLimit({
    family: "v1.items.upvote",
    limit: 120,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const itemId = c.req.param("id");
    const userId = c.get("userId");
    const listId = c.get("itemListId");
    const db = getDb();

    // RETURNING tells us whether a row actually existed — only then do we
    // record the un-upvote event (no spam from repeat clicks on an
    // already-unupvoted item).
    const removed = await db
      .delete(itemUpvotes)
      .where(and(eq(itemUpvotes.itemId, itemId), eq(itemUpvotes.userId, userId)))
      .returning({ itemId: itemUpvotes.itemId });

    if (removed.length > 0) {
      await recordEvent({
        listId,
        actorId: userId,
        type: "item_unupvoted",
        itemId,
      });
    }

    const item = await fetchItemShape(itemId, userId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);

itemRoutes.post("/:id/complete", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const listId = c.get("itemListId");
  const db = getDb();

  const [updated] = await db
    .update(items)
    .set({
      completed: true,
      completedAt: new Date(),
      completedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(items.id, itemId))
    .returning({ id: items.id });
  if (!updated) return err(c, "NOT_FOUND", "item not found");

  await recordEvent({
    listId,
    actorId: userId,
    type: "item_completed",
    itemId,
  });

  const item = await fetchItemShape(itemId, userId);
  if (!item) return err(c, "NOT_FOUND", "item not found");
  return ok(c, { item });
});

itemRoutes.post("/:id/uncomplete", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const listId = c.get("itemListId");
  const db = getDb();

  const [updated] = await db
    .update(items)
    .set({
      completed: false,
      completedAt: null,
      completedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(items.id, itemId))
    .returning({ id: items.id });
  if (!updated) return err(c, "NOT_FOUND", "item not found");

  await recordEvent({
    listId,
    actorId: userId,
    type: "item_uncompleted",
    itemId,
  });

  const item = await fetchItemShape(itemId, userId);
  if (!item) return err(c, "NOT_FOUND", "item not found");
  return ok(c, { item });
});
