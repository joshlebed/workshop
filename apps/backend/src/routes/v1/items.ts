import type { Item, ItemMetadata, ListItemsResponse, ListType } from "@workshop/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type ZodType, z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbItem, items, lists } from "../../db/schema.js";
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
// validator. `position` is allowed on every type so any list can be ordered
// (the album-shelf pattern, generalised).

const positionField = z.union([z.number(), z.null()]).optional();

const movieTvMetadataSchema = z
  .object({
    source: z.union([z.literal("tmdb"), z.literal("manual")]).optional(),
    sourceId: z.string().max(64).optional(),
    posterUrl: z.string().max(2048).optional(),
    year: z.number().int().min(1800).max(2200).optional(),
    runtimeMinutes: z.number().int().min(0).max(10000).optional(),
    overview: z.string().max(4000).optional(),
    position: positionField,
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
    position: positionField,
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
    position: positionField,
  })
  .strict();

// Game items: a URL + display name + an optional thumbnail scraped from the
// page's OG card. Per-day scores live in their own table (`game_scores`)
// rather than in `metadata` so re-pasting upserts cleanly.
const gameMetadataSchema = z
  .object({
    thumbnailUrl: z.string().max(2048).optional(),
    siteName: z.string().max(200).optional(),
    position: positionField,
  })
  .strict();

const metadataSchemasByType: Record<ListType, ZodType<ItemMetadata>> = {
  movie: movieTvMetadataSchema as ZodType<ItemMetadata>,
  tv: movieTvMetadataSchema as ZodType<ItemMetadata>,
  book: bookMetadataSchema as ZodType<ItemMetadata>,
  date_idea: placeMetadataSchema as ZodType<ItemMetadata>,
  trip: placeMetadataSchema as ZodType<ItemMetadata>,
  album_shelf: albumShelfItemMetadataSchema as ZodType<ItemMetadata>,
  game: gameMetadataSchema as ZodType<ItemMetadata>,
};

/**
 * Whitelist of metadata fields a member can mutate on an existing item via
 * `PATCH /v1/items/:id`. For `album_shelf` rows only `position` is mutable;
 * everything else is derived from Spotify and re-set by the refresh path.
 * For other list types we accept the type's full metadata schema so callers
 * can either patch position alone (the common case for drag-to-reorder) or
 * replace enriched fields. The patch is merged into the existing metadata
 * blob so a `{ position }` patch doesn't wipe `posterUrl` / `coverUrl` /
 * etc. set by an earlier provider lookup.
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

function toItemShape(i: DbItem): Item {
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
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

/**
 * Re-selects an item by id, skipping archived rows. Returns null if the row
 * no longer exists (concurrent archive) or has been archived since the last
 * read — same surface as a hard delete from the client's POV.
 */
async function fetchItemShape(itemId: string): Promise<Item | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), isNull(items.archivedAt)))
    .limit(1);
  if (!row) return null;
  return toItemShape(row);
}

interface SplitItemsRow {
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
}

function rowToItem(r: SplitItemsRow): Item {
  return {
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
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
  };
}

/**
 * Fetches every item on a list and splits into the three sections the unified
 * list-detail UI renders (spec §7.2). One SQL query — section assignment
 * happens in JS after sorting.
 *
 * - `ordered`:    completed=false AND `metadata.position` numeric, sorted by position ASC.
 * - `unordered`:  completed=false AND `metadata.position` null/missing, sorted by
 *                 `metadata.detectedAt` (album_shelf) then created_at DESC.
 * - `completed`:  completed=true regardless of position, sorted by completed_at DESC.
 */
export async function fetchItemsForList(listId: string): Promise<ListItemsResponse> {
  const db = getDb();
  const rows = await executeRows<SplitItemsRow>(
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
        i.updated_at
      FROM items i
      WHERE i.list_id = ${listId} AND i.archived_at IS NULL
      ORDER BY
        i.completed ASC,
        (i.metadata->>'position') IS NULL,
        (i.metadata->>'position')::numeric ASC NULLS LAST,
        COALESCE(i.metadata->>'detectedAt', i.created_at::text) DESC,
        i.completed_at DESC NULLS LAST
    `,
  );

  const ordered: Item[] = [];
  const unordered: Item[] = [];
  const completed: Item[] = [];
  for (const r of rows) {
    const item = rowToItem(r);
    if (item.completed) {
      completed.push(item);
      continue;
    }
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.position === "number") {
      ordered.push(item);
    } else {
      unordered.push(item);
    }
  }
  // Completed group is sorted by completed_at DESC — the SQL above sorts
  // in a single pass that's correct for ordered / unordered; resort the
  // completed bucket here so completed_at DESC wins regardless of position.
  completed.sort((a, b) => {
    const ta = a.completedAt ? Date.parse(a.completedAt) : 0;
    const tb = b.completedAt ? Date.parse(b.completedAt) : 0;
    return tb - ta;
  });
  return { ordered, unordered, completed };
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
 * Inserts an item. Looks up the parent list's `type` first so the
 * denormalized `items.type` matches `lists.type` per schema §7.6, and so
 * per-type metadata validation (spec §9.4) runs against the right shape.
 * New items default to the unordered section (`metadata.position` null).
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

    // Game items auto-enter the ordered section so users can reorder them
    // immediately — there's no concept of an "unranked" daily-puzzle game.
    // Use the current max position + 1024 as the seed; midpoint reorders
    // (`midpointForOrderedReorder` in the mobile client) carve out gaps
    // between positions without having to rewrite siblings.
    if (
      parent.type === "game" &&
      typeof (metadata as Record<string, unknown>).position !== "number"
    ) {
      const [maxRow] = await tx
        .select({
          max: sql<number>`COALESCE(MAX((metadata->>'position')::numeric), 0)::float8`,
        })
        .from(items)
        .where(eq(items.listId, listId));
      const next = Number(maxRow?.max ?? 0) + 1024;
      metadata = { ...metadata, position: next };
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

  return toItemShape(created);
}

// --- Item-id-scoped handlers (mounted at /v1/items) ---

itemRoutes.get("/:id", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const item = await fetchItemShape(itemId);
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

  // The metadata patch is always merged into the existing blob (any list
  // type) so a `{ position }` mutation from drag-to-reorder doesn't wipe
  // provider-set fields like posterUrl / coverUrl / detectedAt.
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

    patch.metadata = { ...prevMetadata, ...v.data };
  }

  const [updated] = await db.update(items).set(patch).where(eq(items.id, itemId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "item not found");

  // Choose the activity event for this patch. Cross-section position
  // changes (null ↔ number) fire promote/demote on every list type so the
  // feed stays meaningful when ranking spreads beyond album shelves; pure
  // within-section reorders (number → number) stay silent to keep noise
  // low. Non-position metadata edits emit `item_updated`.
  const eventToRecord = pickPatchEvent({
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

  const item = await fetchItemShape(itemId);
  if (!item) return err(c, "NOT_FOUND", "item not found");
  return ok(c, { item });
});

interface PickPatchEventArgs {
  prevMetadata: ItemMetadata | null;
  nextMetadata: ItemMetadata | undefined;
  metadataPatched: boolean;
  title: string;
}

function pickPatchEvent(a: PickPatchEventArgs): {
  type: "item_updated" | "item_promoted" | "item_demoted";
  payload: Record<string, unknown>;
} | null {
  if (!a.metadataPatched) {
    return { type: "item_updated", payload: { title: a.title } };
  }
  const prevPos = (a.prevMetadata as Record<string, unknown> | null)?.position;
  const nextPos = (a.nextMetadata as Record<string, unknown> | undefined)?.position;
  const wasOrdered = typeof prevPos === "number";
  const nowOrdered = typeof nextPos === "number";
  if (!wasOrdered && nowOrdered) {
    return { type: "item_promoted", payload: { title: a.title, position: nextPos } };
  }
  if (wasOrdered && !nowOrdered) {
    return { type: "item_demoted", payload: { title: a.title } };
  }
  // Within-section reorder, or a non-position metadata edit — emit a
  // generic update so the feed isn't noisy with every drag micro-move,
  // but a real edit still surfaces.
  if (wasOrdered && nowOrdered) return null;
  return { type: "item_updated", payload: { title: a.title } };
}

// Archive (soft delete) the item. Sets `items.archived_at` so it disappears
// from `GET /v1/lists/:id/items`, `GET /v1/items/:id`, activity-feed item
// scopes, and the item-member middleware. Upvotes + score rows stay so a
// future unarchive surface can restore the item intact. The partial unique
// index on (list_id, spotifyAlbumId) includes archived rows, so an
// album-shelf refresh won't resurface an album the user explicitly archived.
itemRoutes.delete("/:id", requireItemMember, async (c) => {
  const itemId = c.req.param("id");
  const userId = c.get("userId");
  const listId = c.get("itemListId");
  const db = getDb();
  const [archived] = await db
    .update(items)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(items.id, itemId), isNull(items.archivedAt)))
    .returning({ id: items.id, title: items.title });
  if (!archived) return err(c, "NOT_FOUND", "item not found");

  // `itemId` deliberately omitted (null in DB) so the activity feed's
  // `archived_at IS NULL` filter on joined `items` doesn't hide the very
  // event that records the archive. The payload still carries `title` for
  // the renderer; matches the legacy `item_deleted` shape.
  await recordEvent({
    listId,
    actorId: userId,
    type: "item_archived",
    payload: { title: archived.title },
  });
  return ok(c, { ok: true });
});

itemRoutes.post(
  "/:id/complete",
  requireItemMember,
  rateLimit({
    family: "v1.items.complete",
    limit: 120,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
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
      .returning({ id: items.id, title: items.title });
    if (!updated) return err(c, "NOT_FOUND", "item not found");

    await recordEvent({
      listId,
      actorId: userId,
      type: "item_completed",
      itemId,
      payload: { title: updated.title },
    });

    const item = await fetchItemShape(itemId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);

itemRoutes.post(
  "/:id/uncomplete",
  requireItemMember,
  rateLimit({
    family: "v1.items.complete",
    limit: 120,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
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
      .returning({ id: items.id, title: items.title });
    if (!updated) return err(c, "NOT_FOUND", "item not found");

    await recordEvent({
      listId,
      actorId: userId,
      type: "item_uncompleted",
      itemId,
      payload: { title: updated.title },
    });

    const item = await fetchItemShape(itemId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);
