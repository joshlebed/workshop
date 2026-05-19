import type {
  Item,
  ItemContent,
  ItemKind,
  LinkPreview,
  ListItemsResponse,
  ModuleName,
} from "@workshop/shared";
import {
  assertItemFitsList,
  ITEM_KIND_NAMES,
  ItemKindMismatchError,
  isItemKind,
  UnknownItemKindError,
  validateContent,
} from "@workshop/shared/itemKinds";
import { hasModule } from "@workshop/shared/modules";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { items, lists } from "../../db/schema.js";
import { toIsoOrNull, toIsoString } from "../../lib/dates.js";
import { recordEvent } from "../../lib/events.js";
import { logger } from "../../lib/logger.js";
import { requireModule, stripModuleGatedItemFields } from "../../lib/moduleGate.js";
import { appendPosition, moveItemPosition } from "../../lib/positions.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { type DbClient, executeRows } from "../../lib/sql.js";
import { parseAndValidateUrl } from "../../lib/ssrf-guard.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireItemMember } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { resolveLinkPreview } from "./link-preview.js";

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

const contentSchema = z.record(z.string(), z.unknown());

const kindSchema = z.enum(ITEM_KIND_NAMES);

export const createItemSchema = z.object({
  kind: kindSchema.optional(),
  title: titleSchema,
  url: urlSchema.optional(),
  note: noteSchema.optional(),
  content: contentSchema.optional(),
});

const updateItemSchema = z
  .object({
    kind: kindSchema.optional(),
    title: titleSchema.optional(),
    url: z.union([urlSchema, z.null()]).optional(),
    note: z.union([noteSchema, z.null()]).optional(),
    content: contentSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

const moveItemSchema = z.object({
  beforeItemId: z.union([z.string().uuid(), z.null()]).optional(),
  afterItemId: z.union([z.string().uuid(), z.null()]).optional(),
});

export const __test = {
  updateItemSchema,
  moveItemSchema,
  clearLinkPreviewContent,
  linkPreviewToContent,
  mergeLinkPreviewContent,
};

// --- Shape helpers ---

interface ItemRow {
  id: string;
  list_id: string;
  kind: string;
  title: string;
  url: string | null;
  note: string | null;
  content: Record<string, unknown> | null;
  position: number | null;
  added_by: string;
  completed: boolean;
  completed_at: Date | string | null;
  completed_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  upvote_count: number;
  viewer_upvoted: boolean;
}

function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    listId: r.list_id,
    kind: (isItemKind(r.kind) ? r.kind : "plain") as ItemKind,
    title: r.title,
    url: r.url,
    note: r.note,
    content: (r.content ?? {}) as ItemContent,
    position: r.position,
    addedBy: r.added_by,
    completed: Boolean(r.completed),
    completedAt: toIsoOrNull(r.completed_at),
    completedBy: r.completed_by,
    upvoteCount: Number(r.upvote_count ?? 0),
    viewerUpvoted: Boolean(r.viewer_upvoted),
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
  };
}

function applyModuleFilters(item: Item, modules: readonly string[]): Item {
  return stripModuleGatedItemFields(item, modules) as Item;
}

const LINK_PREVIEW_CONTENT_KEYS = [
  "source",
  "sourceId",
  "image",
  "imageProxy",
  "thumbnailUrl",
  "siteName",
  "title",
  "description",
] as const;

function clearLinkPreviewContent(content: ItemContent | null | undefined): ItemContent {
  const next: Record<string, unknown> = { ...(content ?? {}) };
  for (const key of LINK_PREVIEW_CONTENT_KEYS) delete next[key];
  return next;
}

function linkPreviewToContent(preview: LinkPreview): ItemContent {
  const content: Record<string, unknown> = {
    source: "link_preview",
    sourceId: preview.finalUrl,
  };
  if (preview.image) content.image = preview.image;
  if (preview.imageProxy) content.imageProxy = preview.imageProxy;
  const thumbnail = preview.imageProxy ?? preview.image ?? preview.favicon;
  if (thumbnail) content.thumbnailUrl = thumbnail;
  if (preview.siteName) content.siteName = preview.siteName;
  if (preview.title) content.title = preview.title;
  if (preview.description) content.description = preview.description;
  return content;
}

function mergeLinkPreviewContent(
  content: ItemContent | null | undefined,
  preview: LinkPreview,
): ItemContent {
  return {
    ...clearLinkPreviewContent(content),
    ...linkPreviewToContent(preview),
  };
}

/**
 * Fetch one item by id with upvote aggregates joined and module-gated fields
 * stripped per the parent list's `modules`.
 */
async function fetchItemShape(
  itemId: string,
  viewerId: string,
  db: DbClient = getDb(),
): Promise<Item | null> {
  const rows = await executeRows<ItemRow & { list_modules: string[] | null }>(
    db,
    sql`
      SELECT
        i.id, i.list_id, COALESCE(i.kind, 'plain') AS kind, i.title, i.url, i.note,
        i.content, i.position, i.added_by, i.completed, i.completed_at, i.completed_by,
        i.created_at, i.updated_at,
        COALESCE((SELECT COUNT(*)::int FROM item_upvotes u WHERE u.item_id = i.id), 0) AS upvote_count,
        COALESCE(EXISTS(SELECT 1 FROM item_upvotes u WHERE u.item_id = i.id AND u.user_id = ${viewerId}), false) AS viewer_upvoted,
        l.modules AS list_modules
      FROM items i
      JOIN lists l ON l.id = i.list_id
      WHERE i.id = ${itemId} AND i.archived_at IS NULL
      LIMIT 1
    `,
  );
  const r = rows[0];
  if (!r) return null;
  const item = rowToItem(r);
  return applyModuleFilters(item, r.list_modules ?? []);
}

/**
 * Fetch every non-archived item on a list, joined with upvote aggregates and
 * the parent list's modules so we can split into the three sections AND
 * strip module-gated fields in one pass. Sections:
 *
 * - `ordered`:   position IS NOT NULL, sorted by position ASC. Suppressed
 *                when `ranking` is off (items collapse into `unordered`).
 * - `unordered`: position IS NULL (or ranking off), sorted by created_at DESC.
 * - `completed`: completed=true, sorted by completed_at DESC. Suppressed
 *                when `todo` is off (items keep their ordered/unordered slot).
 */
export async function fetchItemsForList(
  listId: string,
  viewerId: string,
  db: DbClient = getDb(),
): Promise<ListItemsResponse & { modules: ModuleName[] }> {
  const [listRow] = await db
    .select({ modules: lists.modules })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  const modules = (listRow?.modules ?? []) as ModuleName[];

  const rows = await executeRows<ItemRow>(
    db,
    sql`
      SELECT
        i.id, i.list_id, COALESCE(i.kind, 'plain') AS kind, i.title, i.url, i.note,
        i.content, i.position, i.added_by, i.completed, i.completed_at, i.completed_by,
        i.created_at, i.updated_at,
        COALESCE((SELECT COUNT(*)::int FROM item_upvotes u WHERE u.item_id = i.id), 0) AS upvote_count,
        COALESCE(EXISTS(SELECT 1 FROM item_upvotes u WHERE u.item_id = i.id AND u.user_id = ${viewerId}), false) AS viewer_upvoted
      FROM items i
      WHERE i.list_id = ${listId} AND i.archived_at IS NULL
      ORDER BY
        (i.position IS NULL),
        i.position ASC NULLS LAST,
        COALESCE(i.content->>'detectedAt', i.created_at::text) DESC,
        i.completed_at DESC NULLS LAST
    `,
  );

  const rankingOn = hasModule(modules, "ranking");
  const todoOn = hasModule(modules, "todo");
  const ordered: Item[] = [];
  const unordered: Item[] = [];
  const completed: Item[] = [];
  for (const r of rows) {
    const item = applyModuleFilters(rowToItem(r), modules);
    const isCompleted = todoOn && Boolean(r.completed);
    if (isCompleted) {
      completed.push(item);
      continue;
    }
    if (rankingOn && typeof r.position === "number") {
      ordered.push(item);
    } else {
      unordered.push(item);
    }
  }
  completed.sort((a, b) => {
    const ta = a.completedAt ? Date.parse(a.completedAt) : 0;
    const tb = b.completedAt ? Date.parse(b.completedAt) : 0;
    return tb - ta;
  });
  return { ordered, unordered, completed, modules };
}

/** Thrown by `createItem` when content validation fails. */
export class ItemContentError extends Error {
  readonly issues: unknown;
  constructor(issues: unknown) {
    super("invalid content for item kind");
    this.name = "ItemContentError";
    this.issues = issues;
  }
}

export class ItemKindMismatchRouteError extends Error {
  readonly listItemKind: string;
  readonly itemKind: string;
  constructor(err: ItemKindMismatchError) {
    super(err.message);
    this.name = "ItemKindMismatchRouteError";
    this.listItemKind = err.listItemKind;
    this.itemKind = err.itemKind;
  }
}

/**
 * Insert one item. Validates the content against the kind's zod schema,
 * asserts the kind fits the parent list's `item_kind`, and assigns a
 * default `position` when the parent has the `ranking` module enabled.
 */
export async function createItem(
  listId: string,
  userId: string,
  data: z.infer<typeof createItemSchema>,
): Promise<Item> {
  const db = getDb();
  const inserted = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({
        modules: lists.modules,
        itemKind: lists.itemKind,
      })
      .from(lists)
      .where(eq(lists.id, listId))
      .limit(1);
    if (!parent) throw new Error("list missing during item insert");

    const kind: ItemKind = data.kind
      ? data.kind
      : ((parent.itemKind && isItemKind(parent.itemKind) ? parent.itemKind : "plain") as ItemKind);

    try {
      assertItemFitsList({ itemKind: parent.itemKind as ItemKind | null }, { kind });
    } catch (e) {
      if (e instanceof ItemKindMismatchError) throw new ItemKindMismatchRouteError(e);
      throw e;
    }

    let content: ItemContent = {};
    if (data.content !== undefined) {
      try {
        content = validateContent(kind, data.content);
      } catch (e) {
        if (e instanceof UnknownItemKindError) throw new ItemContentError([{ message: e.message }]);
        const zerr = e as { issues?: unknown };
        if (zerr.issues) throw new ItemContentError(zerr.issues);
        throw e;
      }
    } else {
      try {
        content = validateContent(kind, {});
      } catch {
        // Empty content fine for kinds with required fields when the caller
        // explicitly omits content (e.g. plain).
        content = {};
      }
    }

    const modules = (parent.modules ?? []) as ModuleName[];
    let position: number | null = null;
    if (hasModule(modules, "ranking") && hasModule(modules, "leaderboard")) {
      // Daily-game pattern: items default to ordered so users can rank them.
      position = await appendPosition(listId, tx);
    }

    const [row] = await tx
      .insert(items)
      .values({
        listId,
        kind,
        title: data.title,
        url: data.url ?? null,
        note: data.note ?? null,
        content,
        position,
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
      payload: { title: row.title, kind },
    });
    return row;
  });

  const item = await fetchItemShape(inserted.id, userId);
  if (!item) throw new Error("item disappeared after insert");
  return item;
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

  const [existing] = await db
    .select({
      kind: items.kind,
      url: items.url,
      content: items.content,
      listId: items.listId,
    })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  if (!existing) return err(c, "NOT_FOUND", "item not found");

  const [parent] = await db
    .select({ itemKind: lists.itemKind, modules: lists.modules })
    .from(lists)
    .where(eq(lists.id, existing.listId))
    .limit(1);

  const nextKind: ItemKind = (parsed.data.kind ??
    (isItemKind(existing.kind ?? "") ? (existing.kind as ItemKind) : "plain")) as ItemKind;

  if (parsed.data.kind && parent) {
    try {
      assertItemFitsList({ itemKind: parent.itemKind as ItemKind | null }, { kind: nextKind });
    } catch (e) {
      if (e instanceof ItemKindMismatchError) {
        return err(c, "VALIDATION", "kind_mismatch", {
          code: "kind_mismatch",
          listItemKind: e.listItemKind,
          itemKind: e.itemKind,
        });
      }
      throw e;
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.url !== undefined) patch.url = parsed.data.url;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;
  if (parsed.data.kind !== undefined) patch.kind = parsed.data.kind;
  if (parsed.data.content !== undefined) {
    try {
      patch.content = validateContent(nextKind, parsed.data.content);
    } catch (e) {
      const zerr = e as { issues?: unknown; message?: string };
      return err(c, "VALIDATION", "invalid content for item kind", zerr.issues ?? zerr.message);
    }
  }

  const nextUrl = parsed.data.url ?? null;
  const urlChanged = parsed.data.url !== undefined && nextUrl !== existing.url;
  if (urlChanged && nextKind === "link") {
    const baseContent = (patch.content ?? existing.content ?? {}) as ItemContent;
    const clearedContent = clearLinkPreviewContent(baseContent);

    if (nextUrl === null) {
      patch.content = clearedContent;
    } else {
      try {
        const parsedUrl = parseAndValidateUrl(nextUrl);
        const preview = await resolveLinkPreview(parsedUrl);
        patch.content = mergeLinkPreviewContent(baseContent, preview);
      } catch (error) {
        logger.warn("item link-preview refresh failed", { error, itemId, url: nextUrl });
        patch.content = clearedContent;
      }
    }
  }

  const [updated] = await db.update(items).set(patch).where(eq(items.id, itemId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "item not found");

  await recordEvent({
    listId: updated.listId,
    actorId: userId,
    type: "item_updated",
    itemId: updated.id,
    payload: { title: updated.title },
  });

  const item = await fetchItemShape(itemId, userId);
  if (!item) return err(c, "NOT_FOUND", "item not found");
  return ok(c, { item });
});

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

  await recordEvent({
    listId,
    actorId: userId,
    type: "item_archived",
    payload: { title: archived.title },
  });
  return ok(c, { ok: true });
});

// --- Completion (todo module) ---

async function getParentModules(db: DbClient, listId: string): Promise<ModuleName[]> {
  const [row] = await db
    .select({ modules: lists.modules })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  return (row?.modules ?? []) as ModuleName[];
}

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
    const gate = requireModule(c, await getParentModules(db, listId), "todo");
    if (gate) return gate;

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

    const item = await fetchItemShape(itemId, userId);
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
    const gate = requireModule(c, await getParentModules(db, listId), "todo");
    if (gate) return gate;

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

    const item = await fetchItemShape(itemId, userId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);

// --- Upvotes (voting module) ---

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
    const gate = requireModule(c, await getParentModules(db, listId), "voting");
    if (gate) return gate;

    await db.execute(sql`
      INSERT INTO item_upvotes (item_id, user_id)
      VALUES (${itemId}::uuid, ${userId}::uuid)
      ON CONFLICT DO NOTHING
    `);
    const [titleRow] = await db
      .select({ title: items.title })
      .from(items)
      .where(eq(items.id, itemId))
      .limit(1);
    await recordEvent({
      listId,
      actorId: userId,
      type: "item_upvoted",
      itemId,
      payload: { title: titleRow?.title ?? "" },
    });
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
    const gate = requireModule(c, await getParentModules(db, listId), "voting");
    if (gate) return gate;

    await db.execute(sql`
      DELETE FROM item_upvotes WHERE item_id = ${itemId}::uuid AND user_id = ${userId}::uuid
    `);
    const [titleRow] = await db
      .select({ title: items.title })
      .from(items)
      .where(eq(items.id, itemId))
      .limit(1);
    await recordEvent({
      listId,
      actorId: userId,
      type: "item_unupvoted",
      itemId,
      payload: { title: titleRow?.title ?? "" },
    });
    const item = await fetchItemShape(itemId, userId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);

// --- Move (ranking module) ---

itemRoutes.post(
  "/:id/move",
  requireItemMember,
  rateLimit({
    family: "v1.items.move",
    limit: 240,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const itemId = c.req.param("id");
    const userId = c.get("userId");
    const listId = c.get("itemListId");
    const db = getDb();
    const gate = requireModule(c, await getParentModules(db, listId), "ranking");
    if (gate) return gate;

    const parsed = await parseJsonBody(c, moveItemSchema);
    if (!parsed.ok) return parsed.response;

    const wasOrdered = (
      await db.select({ position: items.position }).from(items).where(eq(items.id, itemId)).limit(1)
    )[0]?.position;

    const result = await moveItemPosition({
      listId,
      itemId,
      beforeItemId: parsed.data.beforeItemId ?? null,
      afterItemId: parsed.data.afterItemId ?? null,
      db,
    });

    const wasOrderedFlag = typeof wasOrdered === "number";
    const isOrderedFlag = result.position !== null;
    let eventType: "item_promoted" | "item_demoted" | null = null;
    if (!wasOrderedFlag && isOrderedFlag) eventType = "item_promoted";
    else if (wasOrderedFlag && !isOrderedFlag) eventType = "item_demoted";

    if (eventType) {
      const [row] = await db
        .select({ title: items.title })
        .from(items)
        .where(eq(items.id, itemId))
        .limit(1);
      await recordEvent({
        listId,
        actorId: userId,
        type: eventType,
        itemId,
        payload: { title: row?.title ?? "" },
      });
    }

    const item = await fetchItemShape(itemId, userId);
    if (!item) return err(c, "NOT_FOUND", "item not found");
    return ok(c, { item });
  },
);
