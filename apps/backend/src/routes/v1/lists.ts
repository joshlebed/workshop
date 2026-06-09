import type {
  ConfigWarning,
  List,
  ListColor,
  ListMemberSummary,
  ListPreview,
  ListSource,
  ListSummary,
  MemberRole,
  ShareVisibility,
} from "@workshop/shared";
import { ITEM_KIND_NAMES, type ItemKind, isItemKind } from "@workshop/shared/itemKinds";
import { MODULE_NAMES, type ModuleName, normalizeModules } from "@workshop/shared/modules";
import { SOURCE_KIND_NAMES, type SourceKind } from "@workshop/shared/sourceKinds";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { withDbRetry } from "../../db/retry.js";
import {
  type DbList,
  type DbListSource,
  items,
  listMembers,
  listSources,
  lists,
  users,
} from "../../db/schema.js";
import { toIsoString } from "../../lib/dates.js";
import { notifyDiscord } from "../../lib/discord.js";
import { recordEvent } from "../../lib/events.js";
import { inspectModuleChange } from "../../lib/moduleManifests.js";
import { requireCapability } from "../../lib/permissions.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { verifySession } from "../../lib/session.js";
import { generateShareSlug, isValidShareSlug } from "../../lib/shareSlug.js";
import { dispatchFor } from "../../lib/sources/registry.js";
import { executeRows } from "../../lib/sql.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireListMember } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import {
  createItem,
  createItemSchema,
  fetchItemsForList,
  ItemContentError,
  ItemKindMismatchRouteError,
} from "./items.js";

export const listRoutes = new Hono();

/**
 * Public, unauthenticated subset of the list surface — currently just
 * `GET /lists/:id/preview`, the landing-page metadata for someone who
 * clicked a per-list share URL without being a member yet. Mounted
 * separately so it sits outside `requireAuth`; same pattern as
 * `publicInviteRoutes` in `./invites.ts`.
 */
export const publicListRoutes = new Hono();

listRoutes.use("*", requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listColors = ["sunset", "ocean", "forest", "grape", "rose", "sand", "slate"] as const;

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

const descriptionSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().max(280, "description too long"));

const COVER_PHOTO_MAX_CHARS = 1_500_000;
const coverPhotoUrlSchema = z
  .string()
  .max(COVER_PHOTO_MAX_CHARS, "cover photo too large")
  .refine(
    (s) => /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s),
    "cover photo must be a base64 data URL",
  );

const modulesSchema = z
  .array(z.enum(MODULE_NAMES))
  .max(MODULE_NAMES.length)
  .transform((m) => normalizeModules(m));

const itemKindSchema = z.enum(ITEM_KIND_NAMES);

const sourceConfigSchema = z.record(z.string(), z.unknown());

const sourcesSchema = z
  .array(
    z.object({
      kind: z.enum(SOURCE_KIND_NAMES),
      config: sourceConfigSchema,
    }),
  )
  .max(4);

const createListSchema = z.object({
  name: nameSchema,
  emoji: emojiSchema,
  color: colorSchema,
  description: descriptionSchema.optional(),
  coverPhotoUrl: coverPhotoUrlSchema.optional(),
  itemKind: z.union([itemKindSchema, z.null()]).optional(),
  modules: modulesSchema,
  sources: sourcesSchema.optional(),
});

const updateListSchema = z
  .object({
    name: nameSchema.optional(),
    emoji: emojiSchema.optional(),
    color: colorSchema.optional(),
    description: z.union([descriptionSchema, z.null()]).optional(),
    coverPhotoUrl: z.union([coverPhotoUrlSchema, z.null()]).optional(),
    itemKind: z.union([itemKindSchema, z.null()]).optional(),
    modules: modulesSchema.optional(),
    acknowledgedWarnings: z.array(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

const duplicateListSchema = z.object({
  name: nameSchema.optional(),
  emoji: emojiSchema.optional(),
  color: colorSchema.optional(),
  description: descriptionSchema.optional(),
  modules: modulesSchema.optional(),
  itemKind: z.union([itemKindSchema, z.null()]).optional(),
  preserveCompletion: z.boolean().optional(),
  copySources: z.boolean().optional(),
});

const configPreviewSchema = z.object({
  modules: modulesSchema.optional(),
  itemKind: z.union([itemKindSchema, z.null()]).optional(),
});

const createSourceSchema = z.object({
  kind: z.enum(SOURCE_KIND_NAMES),
  config: sourceConfigSchema,
});

export const __test = {
  createListSchema,
  updateListSchema,
  configPreviewSchema,
  duplicateListSchema,
  createSourceSchema,
};

function toListShape(l: DbList): List {
  return {
    id: l.id,
    name: l.name,
    emoji: l.emoji,
    color: l.color as ListColor,
    description: l.description,
    coverPhotoUrl: l.coverPhotoUrl,
    ownerId: l.ownerId,
    itemKind: (l.itemKind && isItemKind(l.itemKind) ? (l.itemKind as ItemKind) : null) ?? null,
    modules: (l.modules ?? []) as ModuleName[],
    shareSlug: l.shareSlug,
    shareVisibility: l.shareVisibility as ShareVisibility,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

const SHARE_VISIBILITIES = ["off", "view", "join"] as const satisfies readonly ShareVisibility[];

/**
 * Returns true if `e` is a Postgres unique_violation (SQLSTATE 23505) for the
 * named constraint. Drizzle wraps the original `postgres.PostgresError` in a
 * `DrizzleQueryError` so we walk the cause chain.
 */
function isUniqueViolation(e: unknown, constraint: string): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5; i++) {
    if (!cur || typeof cur !== "object") return false;
    const obj = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (obj.code === "23505" && obj.constraint_name === constraint) return true;
    cur = obj.cause;
  }
  return false;
}

/**
 * Build a public preview payload for a list. Used by both the by-id and
 * by-slug preview endpoints — sharing one shape means the OG image
 * pipeline, public landing page, and link-preview crawlers all consume
 * the same data regardless of which URL the user pasted.
 */
async function buildListPreview(list: DbList): Promise<ListPreview> {
  const db = getDb();
  const [owner] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, list.ownerId))
    .limit(1);

  const countRows = await executeRows<{ item_count: number; member_count: number }>(
    db,
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM items i WHERE i.list_id = ${list.id} AND i.archived_at IS NULL) AS item_count,
        (SELECT COUNT(*)::int FROM list_members m WHERE m.list_id = ${list.id}) AS member_count
    `,
  );
  const counts = countRows[0] ?? { item_count: 0, member_count: 0 };

  return {
    id: list.id,
    name: list.name,
    emoji: list.emoji,
    color: list.color as ListColor,
    description: list.description,
    ownerName: owner?.displayName ?? null,
    itemCount: Number(counts.item_count),
    memberCount: Number(counts.member_count),
    itemKind:
      (list.itemKind && isItemKind(list.itemKind) ? (list.itemKind as ItemKind) : null) ?? null,
    modules: (list.modules ?? []) as ModuleName[],
    shareVisibility: list.shareVisibility as ShareVisibility,
    shareSlug: list.shareSlug,
  };
}

/**
 * Read the optional bearer token from the request without forcing auth.
 * Used by the public preview endpoints so they can label the viewer as
 * "authenticated non-member" vs "anonymous" without 401-ing missing tokens.
 */
function readOptionalViewerId(c: {
  req: { header: (n: string) => string | undefined };
}): string | null {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) return null;
  return verifySession(token)?.userId ?? null;
}

// --- GET /v1/lists/:id/preview (public; landing for non-members) ---

/**
 * Safe metadata exposed at the per-list share URL (`/list/:id`). Returned
 * to anyone, signed in or not, regardless of membership — enables the web
 * landing page to show "what is this list?" before/instead of letting them
 * in. Mirrors `/v1/invites/:token/preview`: name/emoji/owner/counts only;
 * no member identities, no items.
 *
 * `viewer.authenticated` reflects whether a valid bearer was supplied;
 * `viewer.isMember` lets the client pick the right CTA (sign in vs. ask
 * to join vs. open the list) without an extra round trip. We do the auth
 * check inline rather than via `requireAuth` so an absent/invalid token
 * downgrades to anonymous instead of 401-ing.
 *
 * Archived lists are not previewable — the partial-index discipline that
 * filters them out of every other read path applies here too. 404 then,
 * same as a missing or malformed id.
 */
publicListRoutes.get("/lists/:id/preview", async (c) => {
  const listId = c.req.param("id");
  if (!UUID_RE.test(listId)) {
    return err(c, "NOT_FOUND", "list not found");
  }

  const db = getDb();
  // Public, unauthenticated entry point — no requireAuth session check ran
  // first, so this is the request's first DB touch. Retry it through a Neon
  // cold-start (see db/retry.ts) and the warmed connection carries the rest.
  const [list] = await withDbRetry(() =>
    db
      .select()
      .from(lists)
      .where(and(eq(lists.id, listId), isNull(lists.archivedAt)))
      .limit(1),
  );
  if (!list) {
    return err(c, "NOT_FOUND", "list not found");
  }

  const viewerUserId = readOptionalViewerId(c);
  let isMember = false;
  if (viewerUserId) {
    const [m] = await db
      .select({ userId: listMembers.userId })
      .from(listMembers)
      .where(and(eq(listMembers.listId, list.id), eq(listMembers.userId, viewerUserId)))
      .limit(1);
    isMember = !!m;
  }

  const preview = await buildListPreview(list);
  return ok(c, {
    preview,
    viewer: { authenticated: viewerUserId !== null, isMember },
  });
});

// --- GET /v1/lists/by-slug/:slug/items (public when visibility=view) ---

/**
 * Returns the same ordered/unordered/completed split as the by-id items
 * endpoint, but accessible to non-members when the list's `share_visibility`
 * is `view`. `off` and `join` require membership — `join`'s read access only
 * starts once the user has clicked through the join CTA.
 *
 * No member identities or per-viewer view-state are surfaced here — kept
 * deliberately to the same shape as `GET /v1/lists/:id/items` so the
 * read-only landing page can reuse the same item rendering code.
 */
publicListRoutes.get("/lists/by-slug/:slug/items", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidShareSlug(slug)) return err(c, "NOT_FOUND", "list not found");

  const db = getDb();
  // Public, unauthenticated entry point (first DB touch) — retry through a
  // Neon cold-start; the warmed connection carries the rest of the handler.
  const [list] = await withDbRetry(() =>
    db
      .select()
      .from(lists)
      .where(and(eq(lists.shareSlug, slug), isNull(lists.archivedAt)))
      .limit(1),
  );
  if (!list) return err(c, "NOT_FOUND", "list not found");

  const viewerUserId = readOptionalViewerId(c);
  let isMember = false;
  if (viewerUserId) {
    const [m] = await db
      .select({ userId: listMembers.userId })
      .from(listMembers)
      .where(and(eq(listMembers.listId, list.id), eq(listMembers.userId, viewerUserId)))
      .limit(1);
    isMember = !!m;
  }

  if (!isMember && list.shareVisibility !== "view") {
    return err(c, "NOT_FOUND", "list not found");
  }

  const split = await fetchItemsForList(list.id);
  return ok(c, split);
});

// --- GET /v1/lists/by-slug/:slug/preview (public; landing for share URLs) ---

/**
 * Public landing-page preview keyed by the short share slug. Same shape as
 * the by-id preview above, but the route is the one our Pages Functions
 * fetch when building OG / Twitter Card metadata for `/l/:slug` URLs.
 *
 * `visibility=off` 404s for non-members. Members keep access via the
 * canonical `/list/:id` URL or the home screen — the short link is just a
 * shareable surface, not their only entry point. Archived lists also 404.
 */
publicListRoutes.get("/lists/by-slug/:slug/preview", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidShareSlug(slug)) {
    return err(c, "NOT_FOUND", "list not found");
  }

  const db = getDb();
  // Public, unauthenticated entry point (first DB touch) — retry through a
  // Neon cold-start; the warmed connection carries the rest of the handler.
  const [list] = await withDbRetry(() =>
    db
      .select()
      .from(lists)
      .where(and(eq(lists.shareSlug, slug), isNull(lists.archivedAt)))
      .limit(1),
  );
  if (!list) return err(c, "NOT_FOUND", "list not found");

  const viewerUserId = readOptionalViewerId(c);
  let isMember = false;
  if (viewerUserId) {
    const [m] = await db
      .select({ userId: listMembers.userId })
      .from(listMembers)
      .where(and(eq(listMembers.listId, list.id), eq(listMembers.userId, viewerUserId)))
      .limit(1);
    isMember = !!m;
  }

  if (list.shareVisibility === "off" && !isMember) {
    return err(c, "NOT_FOUND", "list not found");
  }

  const preview = await buildListPreview(list);
  return ok(c, {
    preview,
    viewer: { authenticated: viewerUserId !== null, isMember },
  });
});

function toSourceShape(s: DbListSource): ListSource {
  return {
    id: s.id,
    listId: s.listId,
    kind: s.kind as SourceKind,
    config: (s.config ?? {}) as Record<string, unknown>,
    lastSyncedAt: s.lastSyncedAt ? s.lastSyncedAt.toISOString() : null,
    lastSyncedBy: s.lastSyncedBy ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

async function fetchSourcesForList(listId: string): Promise<ListSource[]> {
  const db = getDb();
  const rows = await db.select().from(listSources).where(eq(listSources.listId, listId));
  return rows.map(toSourceShape);
}

listRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const rows = await executeRows<{
    id: string;
    name: string;
    emoji: string;
    color: string;
    description: string | null;
    cover_photo_url: string | null;
    owner_id: string;
    item_kind: string | null;
    modules: string[];
    share_slug: string;
    share_visibility: string;
    created_at: Date | string;
    updated_at: Date | string;
    my_role: string;
    member_count: number;
    item_count: number;
    pinned_at: Date | string | null;
    archived_at: Date | string | null;
    muted_at: Date | string | null;
    unread_count: number;
  }>(
    db,
    sql`
      SELECT
        l.id, l.name, l.emoji, l.color, l.description, l.cover_photo_url, l.owner_id,
        l.item_kind, l.modules, l.share_slug, l.share_visibility, l.created_at, l.updated_at,
        me.role::text AS my_role, me.pinned_at, me.archived_at, me.muted_at,
        (SELECT COUNT(*)::int FROM list_members m WHERE m.list_id = l.id) AS member_count,
        (SELECT COUNT(*)::int FROM items i WHERE i.list_id = l.id AND i.archived_at IS NULL) AS item_count,
        CASE
          WHEN me.muted_at IS NOT NULL THEN 0
          ELSE LEAST(99, (
            SELECT COUNT(*)::int FROM activity_events e
            LEFT JOIN user_activity_reads r
              ON r.user_id = ${userId} AND r.list_id = l.id
            WHERE e.list_id = l.id
              AND e.actor_id <> ${userId}
              AND (r.last_read_at IS NULL OR e.created_at > r.last_read_at)
          ))
        END AS unread_count
      FROM lists l
      JOIN list_members me ON me.list_id = l.id AND me.user_id = ${userId}
      WHERE l.archived_at IS NULL
      ORDER BY l.updated_at DESC
    `,
  );

  const summaries: ListSummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    emoji: r.emoji,
    color: r.color as ListColor,
    description: r.description,
    coverPhotoUrl: r.cover_photo_url,
    ownerId: r.owner_id,
    itemKind: (r.item_kind && isItemKind(r.item_kind) ? r.item_kind : null) as ItemKind | null,
    modules: (r.modules ?? []) as ModuleName[],
    shareSlug: r.share_slug,
    shareVisibility: r.share_visibility as ShareVisibility,
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
    role: r.my_role as MemberRole,
    memberCount: Number(r.member_count),
    itemCount: Number(r.item_count),
    pinnedAt: r.pinned_at ? toIsoString(r.pinned_at) : null,
    archivedAt: r.archived_at ? toIsoString(r.archived_at) : null,
    mutedAt: r.muted_at ? toIsoString(r.muted_at) : null,
    unreadCount: Number(r.unread_count),
  }));

  return ok(c, { lists: summaries });
});

listRoutes.post("/", async (c) => {
  const parsed = await parseJsonBody(c, createListSchema);
  if (!parsed.ok) return parsed.response;
  const userId = c.get("userId");
  const db = getDb();
  const data = parsed.data;

  // Validate any sources up-front so we don't create an orphan list. The
  // dispatcher rejects unknown kinds with a v1 error envelope.
  const validatedSources: Array<{ kind: SourceKind; config: Record<string, unknown> }> = [];
  for (const source of data.sources ?? []) {
    const dispatch = dispatchFor(source.kind);
    const validated = await dispatch.preview(c, source.config);
    if (!validated.ok) return validated.response;
    validatedSources.push({ kind: source.kind, config: validated.config });
  }

  const created: DbList = await db.transaction(async (tx) => {
    // Retry the insert on the (rare) unique_violation when our random
    // 8-char base62 slug collides with an existing row. Postgres aborts
    // the transaction on a constraint violation, so we generate up-front
    // and re-roll only on the explicit error code rather than wrapping
    // the whole insert in a retry loop.
    let createdList: DbList | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [row] = await tx
          .insert(lists)
          .values({
            name: data.name,
            emoji: data.emoji,
            color: data.color,
            description: data.description ?? null,
            coverPhotoUrl: data.coverPhotoUrl ?? null,
            ownerId: userId,
            itemKind: data.itemKind ?? null,
            modules: data.modules,
            shareSlug: generateShareSlug(),
          })
          .returning();
        createdList = row;
        break;
      } catch (e) {
        if (isUniqueViolation(e, "lists_share_slug_unique")) continue;
        throw e;
      }
    }
    const list = createdList;
    if (!list) throw new Error("list insert: share_slug collision retries exhausted");

    await tx.insert(listMembers).values({
      listId: list.id,
      userId,
      role: "owner",
    });

    await recordEvent({
      db: tx,
      listId: list.id,
      actorId: userId,
      type: "list_created",
      payload: { name: list.name, itemKind: list.itemKind, modules: list.modules },
    });

    for (const source of validatedSources) {
      const [src] = await tx
        .insert(listSources)
        .values({
          listId: list.id,
          kind: source.kind,
          config: source.config,
        })
        .returning();
      if (!src) continue;
      await recordEvent({
        db: tx,
        listId: list.id,
        actorId: userId,
        type: "source_added",
        payload: { kind: source.kind, config: source.config },
      });

      const dispatch = dispatchFor(source.kind);
      const result = await dispatch.sync({
        listId: list.id,
        userId,
        config: source.config,
        db: tx,
      });
      await tx
        .update(listSources)
        .set({ lastSyncedAt: result.refreshedAt, lastSyncedBy: userId })
        .where(eq(listSources.id, src.id));
      await recordEvent({
        db: tx,
        listId: list.id,
        actorId: userId,
        type: "source_synced",
        payload: { kind: source.kind, addedCount: result.addedCount },
      });
    }

    const [refreshed] = await tx.select().from(lists).where(eq(lists.id, list.id)).limit(1);
    return refreshed ?? list;
  });

  const [actor] = await db
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const actorLabel = actor?.displayName ?? actor?.email ?? userId;
  const modulesLabel = (created.modules ?? []).join(" · ");
  const kindLabel = created.itemKind ?? "any";
  await notifyDiscord(
    `:clipboard: new list — "${created.name}" (${kindLabel}${modulesLabel ? `, ${modulesLabel}` : ""}) by ${actorLabel}`,
    { kind: "new_list" },
  );

  return ok(c, { list: toListShape(created) }, 201);
});

listRoutes.get("/:id", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const db = getDb();
  const [list] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), isNull(lists.archivedAt)))
    .limit(1);
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

  const sources = await fetchSourcesForList(listId);

  return ok(c, {
    list: toListShape(list),
    members,
    sources,
  });
});

// --- POST /v1/lists/:id/share/reset (owner-only, rotates share slug) ---

/**
 * Rotates `lists.share_slug`. Used as the "kill an old link that got leaked"
 * hammer — the previous slug 404s immediately on every share URL surface
 * (OG preview, public landing, join). Existing members keep access via the
 * canonical `/list/:id` URL and the home screen; this only invalidates the
 * shareable short URL.
 *
 * Visibility isn't touched here — pair this with `PATCH /share` to also flip
 * the link off in one motion. Idempotent under burst-press because each call
 * produces a fresh slug.
 */
listRoutes.post("/:id/share/reset", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const role = c.get("listMemberRole");
  if (role !== "owner") return err(c, "FORBIDDEN", "owner only");

  const db = getDb();
  let rotated: { share_slug: string; share_visibility: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .update(lists)
        .set({ shareSlug: generateShareSlug(), updatedAt: new Date() })
        .where(and(eq(lists.id, listId), isNull(lists.archivedAt)))
        .returning({ share_slug: lists.shareSlug, share_visibility: lists.shareVisibility });
      rotated = row ?? null;
      break;
    } catch (e) {
      if (isUniqueViolation(e, "lists_share_slug_unique")) continue;
      throw e;
    }
  }
  if (!rotated) return err(c, "NOT_FOUND", "list not found");
  return ok(c, {
    shareSlug: rotated.share_slug,
    shareVisibility: rotated.share_visibility as ShareVisibility,
  });
});

// --- PATCH /v1/lists/:id/share (owner-only, sets visibility) ---

const updateShareSchema = z.object({
  visibility: z.enum(SHARE_VISIBILITIES),
});

listRoutes.patch("/:id/share", requireListMember, async (c) => {
  const parsed = await parseJsonBody(c, updateShareSchema);
  if (!parsed.ok) return parsed.response;
  const listId = c.req.param("id");
  const role = c.get("listMemberRole");
  if (role !== "owner") return err(c, "FORBIDDEN", "owner only");

  const db = getDb();
  const [row] = await db
    .update(lists)
    .set({ shareVisibility: parsed.data.visibility, updatedAt: new Date() })
    .where(and(eq(lists.id, listId), isNull(lists.archivedAt)))
    .returning({ share_slug: lists.shareSlug, share_visibility: lists.shareVisibility });
  if (!row) return err(c, "NOT_FOUND", "list not found");

  return ok(c, {
    shareSlug: row.share_slug,
    shareVisibility: row.share_visibility as ShareVisibility,
  });
});

// --- POST /v1/lists/by-slug/:slug/join (auth, anyone with the link joins) ---

/**
 * Public-link join — the slug equivalent of the legacy
 * `POST /v1/invites/:token/accept` flow. Authenticated, rate-limited at the
 * Hono layer, idempotent against existing membership (re-joining is a no-op
 * that just returns the current member row).
 *
 * Blocked when `share_visibility = 'off'` or the list is archived — 404
 * either way so we don't leak whether the slug exists. `share_visibility =
 * 'view'` returns 403; the link grants read access but not membership.
 */
listRoutes.post("/by-slug/:slug/join", async (c) => {
  const slug = c.req.param("slug");
  if (!isValidShareSlug(slug)) return err(c, "NOT_FOUND", "list not found");

  const userId = c.get("userId");
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    const [list] = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.shareSlug, slug), isNull(lists.archivedAt)))
      .limit(1);
    if (!list) return { kind: "not_found" as const };
    if (list.shareVisibility === "off") return { kind: "not_found" as const };
    if (list.shareVisibility === "view") return { kind: "view_only" as const };

    const [existing] = await tx
      .select()
      .from(listMembers)
      .where(and(eq(listMembers.listId, list.id), eq(listMembers.userId, userId)))
      .limit(1);

    let memberRow = existing;
    let newlyJoined = false;
    if (!memberRow) {
      const [inserted] = await tx
        .insert(listMembers)
        .values({ listId: list.id, userId, role: "member" })
        .returning();
      if (!inserted) throw new Error("member insert returned no row");
      memberRow = inserted;
      newlyJoined = true;
    }

    if (newlyJoined) {
      await recordEvent({
        db: tx,
        listId: list.id,
        actorId: userId,
        type: "member_joined",
        payload: { via: "share_slug" },
      });
    }

    return { kind: "ok" as const, list, member: memberRow };
  });

  if (result.kind === "not_found") return err(c, "NOT_FOUND", "list not found");
  if (result.kind === "view_only") {
    return err(c, "FORBIDDEN", "list_view_only", { code: "list_view_only" }, 403);
  }

  const [userRow] = await db
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const memberSummary: ListMemberSummary = {
    userId: result.member.userId,
    displayName: userRow?.displayName ?? null,
    role: result.member.role as MemberRole,
    joinedAt: result.member.joinedAt.toISOString(),
  };

  return ok(c, { list: toListShape(result.list), member: memberSummary });
});

listRoutes.patch("/:id", requireListMember, async (c) => {
  const parsed = await parseJsonBody(c, updateListSchema);
  if (!parsed.ok) return parsed.response;
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const role = c.get("listMemberRole");
  const db = getDb();
  const data = parsed.data;

  const wantsMetadata =
    data.name !== undefined ||
    data.emoji !== undefined ||
    data.color !== undefined ||
    data.description !== undefined ||
    data.coverPhotoUrl !== undefined;
  const wantsModules = data.modules !== undefined;
  const wantsItemKind = data.itemKind !== undefined;

  if (wantsMetadata) {
    const denied = requireCapability(c, role, "edit_list_metadata");
    if (denied) return denied;
  }
  if (wantsModules) {
    const denied = requireCapability(c, role, "edit_modules");
    if (denied) return denied;
  }
  if (wantsItemKind) {
    const denied = requireCapability(c, role, "edit_item_kind");
    if (denied) return denied;
  }

  const [existing] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
  if (!existing) return err(c, "NOT_FOUND", "list not found");

  // item_kind tightening: must not violate the homogeneity invariant.
  if (wantsItemKind && data.itemKind !== null && data.itemKind !== existing.itemKind) {
    const mismatchRows = await executeRows<{ count: number }>(
      db,
      sql`SELECT COUNT(*)::int AS count FROM items WHERE list_id = ${listId} AND archived_at IS NULL AND kind <> ${data.itemKind}`,
    );
    const mismatchCount = Number(mismatchRows[0]?.count ?? 0);
    if (mismatchCount > 0) {
      return err(
        c,
        "CONFLICT",
        "kind_constraint_violation",
        {
          code: "kind_constraint_violation",
          mismatchCount,
        },
        409,
      );
    }
  }

  // Module removal warnings.
  if (wantsModules) {
    const nextModules = data.modules ?? [];
    const currentModules = existing.modules ?? [];
    const removedCount = currentModules.filter((m) => !nextModules.includes(m)).length;
    if (removedCount > 0) {
      const warnings = await inspectModuleChange({
        listId,
        currentModules,
        nextModules,
        db,
      });
      const acknowledged = new Set(data.acknowledgedWarnings ?? []);
      const unacknowledged = warnings.filter((w) => !acknowledged.has(w.code));
      if (unacknowledged.length > 0) {
        return err(c, "CONFLICT", "unacknowledged_warnings", { warnings: unacknowledged }, 409);
      }
    }
  }

  const patch: Partial<DbList> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.emoji !== undefined) patch.emoji = data.emoji;
  if (data.color !== undefined) patch.color = data.color;
  if (data.description !== undefined) patch.description = data.description;
  if (data.coverPhotoUrl !== undefined) patch.coverPhotoUrl = data.coverPhotoUrl;
  if (wantsItemKind) patch.itemKind = data.itemKind ?? null;
  if (wantsModules && data.modules !== undefined) patch.modules = data.modules as ModuleName[];

  const [updated] = await db.update(lists).set(patch).where(eq(lists.id, listId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "list not found");

  // Activity events for module + item_kind transitions.
  if (wantsModules) {
    const next = data.modules ?? [];
    const prev = existing.modules ?? [];
    for (const m of next) {
      if (!prev.includes(m)) {
        await recordEvent({
          listId,
          actorId: userId,
          type: "module_enabled",
          payload: { module: m },
        });
      }
    }
    for (const m of prev) {
      if (!next.includes(m)) {
        await recordEvent({
          listId,
          actorId: userId,
          type: "module_disabled",
          payload: { module: m },
        });
      }
    }
  }

  return ok(c, { list: toListShape(updated) });
});

// --- Config preview ---

listRoutes.post("/:id/config-preview", requireListMember, async (c) => {
  const parsed = await parseJsonBody(c, configPreviewSchema);
  if (!parsed.ok) return parsed.response;
  const listId = c.req.param("id");
  const role = c.get("listMemberRole");
  const denied = requireCapability(c, role, "edit_modules");
  if (denied) return denied;

  const db = getDb();
  const [existing] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
  if (!existing) return err(c, "NOT_FOUND", "list not found");

  const warnings: ConfigWarning[] = [];
  if (parsed.data.modules !== undefined) {
    warnings.push(
      ...(await inspectModuleChange({
        listId,
        currentModules: existing.modules ?? [],
        nextModules: parsed.data.modules,
        db,
      })),
    );
  }

  if (
    parsed.data.itemKind !== undefined &&
    parsed.data.itemKind !== null &&
    parsed.data.itemKind !== existing.itemKind
  ) {
    const mismatchRows = await executeRows<{ count: number }>(
      db,
      sql`SELECT COUNT(*)::int AS count FROM items WHERE list_id = ${listId} AND archived_at IS NULL AND kind <> ${parsed.data.itemKind}`,
    );
    const mismatchCount = Number(mismatchRows[0]?.count ?? 0);
    if (mismatchCount > 0) {
      warnings.push({
        code: "item_kind.tighten_blocked",
        message: `${mismatchCount} item${mismatchCount === 1 ? "" : "s"} of a different kind would block this change. Convert or archive them first.`,
        affectedCount: mismatchCount,
      });
    }
  }

  return ok(c, { warnings });
});

// --- Per-(list, viewer) presentation state ---

type ViewStateColumn = "pinnedAt" | "archivedAt" | "mutedAt";

async function setViewStateFlag(
  listId: string,
  userId: string,
  column: ViewStateColumn,
  value: Date | null,
): Promise<void> {
  const db = getDb();
  await db
    .update(listMembers)
    .set({ [column]: value })
    .where(sql`${listMembers.listId} = ${listId} AND ${listMembers.userId} = ${userId}`);
}

listRoutes.post("/:id/read", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const db = getDb();
  await db.execute(sql`
    INSERT INTO user_activity_reads (user_id, list_id, last_read_at)
    VALUES (${userId}::uuid, ${listId}::uuid, now())
    ON CONFLICT (user_id, list_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at
  `);
  return ok(c, { ok: true });
});

listRoutes.post("/:id/pin", requireListMember, async (c) => {
  await setViewStateFlag(c.req.param("id"), c.get("userId"), "pinnedAt", new Date());
  return ok(c, { ok: true });
});
listRoutes.delete("/:id/pin", requireListMember, async (c) => {
  await setViewStateFlag(c.req.param("id"), c.get("userId"), "pinnedAt", null);
  return ok(c, { ok: true });
});
listRoutes.post("/:id/archive", requireListMember, async (c) => {
  await setViewStateFlag(c.req.param("id"), c.get("userId"), "archivedAt", new Date());
  return ok(c, { ok: true });
});
listRoutes.delete("/:id/archive", requireListMember, async (c) => {
  await setViewStateFlag(c.req.param("id"), c.get("userId"), "archivedAt", null);
  return ok(c, { ok: true });
});
listRoutes.post("/:id/mute", requireListMember, async (c) => {
  await setViewStateFlag(c.req.param("id"), c.get("userId"), "mutedAt", new Date());
  return ok(c, { ok: true });
});
listRoutes.delete("/:id/mute", requireListMember, async (c) => {
  await setViewStateFlag(c.req.param("id"), c.get("userId"), "mutedAt", null);
  return ok(c, { ok: true });
});

// --- Soft-archive (owner-only) ---

listRoutes.delete("/:id", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const role = c.get("listMemberRole");
  const denied = requireCapability(c, role, "archive_list");
  if (denied) return denied;
  const db = getDb();
  const archived = await db
    .update(lists)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(lists.id, listId), isNull(lists.archivedAt)))
    .returning({ id: lists.id, name: lists.name });
  if (archived.length === 0) return err(c, "NOT_FOUND", "list not found");

  const row = archived[0];
  if (row) {
    await recordEvent({
      listId,
      actorId: userId,
      type: "list_archived",
      payload: { name: row.name },
    });
  }
  return ok(c, { ok: true });
});

// --- Duplicate ---

listRoutes.post(
  "/:id/duplicate",
  requireListMember,
  rateLimit({
    family: "v1.lists.duplicate",
    limit: 20,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, duplicateListSchema);
    if (!parsed.ok) return parsed.response;
    const sourceListId = c.req.param("id");
    const userId = c.get("userId");
    const role = c.get("listMemberRole");
    const denied = requireCapability(c, role, "duplicate");
    if (denied) return denied;
    const db = getDb();

    const [source] = await db
      .select()
      .from(lists)
      .where(and(eq(lists.id, sourceListId), isNull(lists.archivedAt)))
      .limit(1);
    if (!source) return err(c, "NOT_FOUND", "list not found");

    const nextModules = parsed.data.modules ?? (source.modules as ModuleName[]) ?? [];
    const nextItemKind =
      parsed.data.itemKind !== undefined
        ? parsed.data.itemKind
        : (source.itemKind as ItemKind | null);

    const dup = await db.transaction(async (tx) => {
      let createdDup: DbList | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const [row] = await tx
            .insert(lists)
            .values({
              name: parsed.data.name ?? `${source.name} (copy)`,
              emoji: parsed.data.emoji ?? source.emoji,
              color: (parsed.data.color ?? source.color) as ListColor,
              description: parsed.data.description ?? source.description,
              coverPhotoUrl: source.coverPhotoUrl,
              ownerId: userId,
              itemKind: nextItemKind,
              modules: nextModules,
              shareSlug: generateShareSlug(),
            })
            .returning();
          createdDup = row;
          break;
        } catch (e) {
          if (isUniqueViolation(e, "lists_share_slug_unique")) continue;
          throw e;
        }
      }
      const created = createdDup;
      if (!created) throw new Error("duplicate insert: share_slug collision retries exhausted");
      await tx.insert(listMembers).values({
        listId: created.id,
        userId,
        role: "owner",
      });
      await recordEvent({
        db: tx,
        listId: created.id,
        actorId: userId,
        type: "list_created",
        payload: { name: created.name, itemKind: created.itemKind, modules: created.modules },
      });
      // Source list activity event.
      await recordEvent({
        db: tx,
        listId: source.id,
        actorId: userId,
        type: "list_duplicated",
        payload: { sourceListId: source.id, duplicateListId: created.id, name: created.name },
      });

      // Copy non-archived items.
      const sourceItems = await tx
        .select()
        .from(items)
        .where(and(eq(items.listId, source.id), isNull(items.archivedAt)));
      const preserveCompletion = parsed.data.preserveCompletion ?? false;
      for (const it of sourceItems) {
        const [newItem] = await tx
          .insert(items)
          .values({
            listId: created.id,
            kind: it.kind,
            title: it.title,
            url: it.url,
            note: it.note,
            content: it.content,
            position: it.position,
            addedBy: userId,
            completed: preserveCompletion ? it.completed : false,
            completedAt: preserveCompletion ? it.completedAt : null,
            completedBy: preserveCompletion ? it.completedBy : null,
          })
          .returning({ id: items.id });
        if (newItem) {
          await recordEvent({
            db: tx,
            listId: created.id,
            actorId: userId,
            type: "item_added",
            itemId: newItem.id,
            payload: { title: it.title, kind: it.kind, copiedFrom: source.id },
          });
        }
      }

      if (parsed.data.copySources) {
        const sourceRows = await tx
          .select()
          .from(listSources)
          .where(eq(listSources.listId, source.id));
        for (const s of sourceRows) {
          await tx.insert(listSources).values({
            listId: created.id,
            kind: s.kind,
            config: s.config,
          });
        }
      }

      return created;
    });

    return ok(c, { list: toListShape(dup) }, 201);
  },
);

// --- List-scoped items ---

listRoutes.get("/:id/items", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const split = await fetchItemsForList(listId);
  return ok(c, split);
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
    const parsed = await parseJsonBody(c, createItemSchema);
    if (!parsed.ok) return parsed.response;
    const listId = c.req.param("id");
    const userId = c.get("userId");

    const db = getDb();
    const [parent] = await db
      .select({ itemKind: lists.itemKind })
      .from(lists)
      .where(eq(lists.id, listId))
      .limit(1);
    if (!parent) return err(c, "NOT_FOUND", "list not found");
    // Spotify-sourced kinds aren't manually added — the source's sync runs
    // for that. Block manual adds.
    if (parent.itemKind === "spotify_album") {
      return err(c, "VALIDATION", "items cannot be added manually to a Spotify-sourced list");
    }

    try {
      const item = await createItem(listId, userId, parsed.data);
      return ok(c, { item }, 201);
    } catch (e) {
      if (e instanceof ItemContentError) {
        return err(c, "VALIDATION", "invalid content for item kind", e.issues);
      }
      if (e instanceof ItemKindMismatchRouteError) {
        return err(c, "VALIDATION", "kind_mismatch", {
          code: "kind_mismatch",
          listItemKind: e.listItemKind,
          itemKind: e.itemKind,
        });
      }
      throw e;
    }
  },
);

const BULK_LIMIT = 50;
const bulkCreateItemsSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(500).trim(),
        url: z.string().min(1).max(2048).trim().optional(),
        note: z.string().max(1000).trim().optional(),
        kind: z.enum(ITEM_KIND_NAMES).optional(),
        content: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(BULK_LIMIT),
});

listRoutes.post(
  "/:id/items/bulk",
  requireListMember,
  rateLimit({
    family: "v1.items.bulk-create",
    limit: 20,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const parsed = await parseJsonBody(c, bulkCreateItemsSchema);
    if (!parsed.ok) return parsed.response;
    const listId = c.req.param("id");
    const userId = c.get("userId");
    const db = getDb();
    const [parent] = await db
      .select({ itemKind: lists.itemKind })
      .from(lists)
      .where(eq(lists.id, listId))
      .limit(1);
    if (!parent) return err(c, "NOT_FOUND", "list not found");
    if (parent.itemKind === "spotify_album") {
      return err(c, "VALIDATION", "items cannot be added manually to a Spotify-sourced list");
    }

    const created: Awaited<ReturnType<typeof createItem>>[] = [];
    for (const row of parsed.data.items) {
      if (!row.title.trim()) continue;
      try {
        const item = await createItem(listId, userId, {
          title: row.title,
          url: row.url,
          note: row.note,
          kind: row.kind,
          content: row.content,
        });
        created.push(item);
      } catch (e) {
        if (e instanceof ItemContentError) {
          return err(c, "VALIDATION", "invalid content", {
            issues: e.issues,
            createdSoFar: created.length,
          });
        }
        if (e instanceof ItemKindMismatchRouteError) {
          return err(c, "VALIDATION", "kind_mismatch", {
            code: "kind_mismatch",
            listItemKind: e.listItemKind,
            itemKind: e.itemKind,
            createdSoFar: created.length,
          });
        }
        throw e;
      }
    }
    return ok(c, { created: created.length, items: created }, 201);
  },
);

// --- Sources ---

listRoutes.get("/:id/sources", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const sources = await fetchSourcesForList(listId);
  return ok(c, { sources });
});

listRoutes.post("/:id/sources", requireListMember, async (c) => {
  const parsed = await parseJsonBody(c, createSourceSchema);
  if (!parsed.ok) return parsed.response;
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const role = c.get("listMemberRole");
  const denied = requireCapability(c, role, "edit_sources");
  if (denied) return denied;
  const db = getDb();
  const [list] = await db
    .select({ modules: lists.modules })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!list) return err(c, "NOT_FOUND", "list not found");
  if (!(list.modules ?? []).includes("sources")) {
    return err(
      c,
      "CONFLICT",
      "module_disabled",
      {
        code: "sources.disabled",
        module: "sources",
        message:
          "This list doesn't have external sources enabled. Turn on Sources in list settings to attach a source.",
      },
      409,
    );
  }

  const dispatch = dispatchFor(parsed.data.kind);
  const validated = await dispatch.preview(c, parsed.data.config);
  if (!validated.ok) return validated.response;

  const result = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(listSources)
      .values({
        listId,
        kind: parsed.data.kind,
        config: validated.config,
      })
      .returning();
    if (!created) throw new Error("source insert returned no row");
    await recordEvent({
      db: tx,
      listId,
      actorId: userId,
      type: "source_added",
      payload: { kind: created.kind, config: validated.config },
    });
    const sync = await dispatch.sync({
      listId,
      userId,
      config: validated.config,
      db: tx,
    });
    await tx
      .update(listSources)
      .set({ lastSyncedAt: sync.refreshedAt, lastSyncedBy: userId })
      .where(eq(listSources.id, created.id));
    await recordEvent({
      db: tx,
      listId,
      actorId: userId,
      type: "source_synced",
      payload: { kind: created.kind, addedCount: sync.addedCount },
    });
    const [reread] = await tx
      .select()
      .from(listSources)
      .where(eq(listSources.id, created.id))
      .limit(1);
    return { source: reread ?? created, addedCount: sync.addedCount };
  });

  return ok(c, { source: toSourceShape(result.source), addedCount: result.addedCount }, 201);
});

listRoutes.delete("/:id/sources/:sourceId", requireListMember, async (c) => {
  const listId = c.req.param("id");
  const sourceId = c.req.param("sourceId");
  const userId = c.get("userId");
  const role = c.get("listMemberRole");
  const denied = requireCapability(c, role, "edit_sources");
  if (denied) return denied;
  const db = getDb();
  const [row] = await db
    .delete(listSources)
    .where(and(eq(listSources.id, sourceId), eq(listSources.listId, listId)))
    .returning({ kind: listSources.kind });
  if (!row) return err(c, "NOT_FOUND", "source not found");
  await recordEvent({
    listId,
    actorId: userId,
    type: "source_removed",
    payload: { kind: row.kind },
  });
  return ok(c, { ok: true });
});

listRoutes.post(
  "/:id/sources/:sourceId/sync",
  requireListMember,
  rateLimit({
    family: "v1.sources.sync",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const listId = c.req.param("id");
    const sourceId = c.req.param("sourceId");
    const userId = c.get("userId");
    const role = c.get("listMemberRole");
    const denied = requireCapability(c, role, "sync_source");
    if (denied) return denied;
    const db = getDb();
    const [source] = await db
      .select()
      .from(listSources)
      .where(and(eq(listSources.id, sourceId), eq(listSources.listId, listId)))
      .limit(1);
    if (!source) return err(c, "NOT_FOUND", "source not found");

    if (!(SOURCE_KIND_NAMES as readonly string[]).includes(source.kind)) {
      return err(c, "VALIDATION", `cannot sync source kind: ${source.kind}`);
    }
    const dispatch = dispatchFor(source.kind as SourceKind);
    const result = await dispatch.sync({
      listId,
      userId,
      config: (source.config ?? {}) as Record<string, unknown>,
      db,
    });
    await db
      .update(listSources)
      .set({ lastSyncedAt: result.refreshedAt, lastSyncedBy: userId })
      .where(eq(listSources.id, sourceId));
    await recordEvent({
      listId,
      actorId: userId,
      type: "source_synced",
      payload: { kind: source.kind, addedCount: result.addedCount },
    });
    const split = await fetchItemsForList(listId);
    const [reread] = await db
      .select()
      .from(listSources)
      .where(eq(listSources.id, sourceId))
      .limit(1);
    return ok(c, {
      ...split,
      source: reread ? toSourceShape(reread) : null,
      addedCount: result.addedCount,
    });
  },
);

// Note: the legacy `POST /v1/lists/:id/refresh` alias was removed.
// Use `POST /v1/lists/:id/sources/:sourceId/sync` instead.
