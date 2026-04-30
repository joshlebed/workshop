import type {
  AlbumShelfListMetadata,
  List,
  ListColor,
  ListMemberSummary,
  ListMetadata,
  ListSummary,
  MemberRole,
} from "@workshop/shared";
import { eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { type DbList, listMembers, lists, users } from "../../db/schema.js";
import {
  asAlbumShelfMetadata,
  fetchAlbumShelfItems,
  refreshAlbumShelfItems,
} from "../../lib/album-shelf.js";
import { toIsoString } from "../../lib/dates.js";
import { recordEvent } from "../../lib/events.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { fetchPlaylistMeta } from "../../lib/spotify/app-client.js";
import { mapSpotifyError } from "../../lib/spotify/error-mapping.js";
import { InvalidPlaylistUrlError, parsePlaylistId } from "../../lib/spotify/playlist-parser.js";
import { executeRows } from "../../lib/sql.js";
import { albumShelfListMetadataPatchSchema } from "../../lib/validators/album-shelf.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireListMember, requireListOwner } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { fetchPendingInvitesForList } from "./invites.js";
import { createItem, createItemSchema, fetchItemsForList, ItemMetadataError } from "./items.js";

export const listRoutes = new Hono();

listRoutes.use("*", requireAuth);

const listColors = ["sunset", "ocean", "forest", "grape", "rose", "sand", "slate"] as const;
const listTypes = ["movie", "tv", "book", "date_idea", "trip", "album_shelf"] as const;

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
  // Required iff type === 'album_shelf'. Verified at the route layer so we
  // can return a structured error code distinguishing missing vs. malformed.
  spotifyPlaylistUrl: z.string().min(1).max(2048).optional(),
});

export const updateListSchema = z
  .object({
    name: nameSchema.optional(),
    emoji: emojiSchema.optional(),
    color: colorSchema.optional(),
    // null clears, undefined leaves alone, string updates.
    description: z.union([descriptionSchema, z.null()]).optional(),
    // For album_shelf lists, members can patch `metadata.spotifyPlaylistUrl`
    // (per spec §3.5) — that path is open to any member, not owner-only.
    metadata: z.record(z.string(), z.unknown()).optional(),
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
    metadata: (l.metadata ?? {}) as ListMetadata,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

/**
 * Parse + verify a public-playlist URL once. Returns the v1 error envelope on
 * failure; caller should `return` it. On success the parsed playlist id is
 * returned alongside the original URL so callers can persist both.
 */
async function validatePlaylistUrl(
  c: Context,
  url: string,
): Promise<{ ok: true; playlistId: string; url: string } | { ok: false; response: Response }> {
  let playlistId: string;
  try {
    playlistId = parsePlaylistId(url);
  } catch (e) {
    if (e instanceof InvalidPlaylistUrlError) {
      return {
        ok: false,
        response: err(c, "VALIDATION", "invalid playlist URL", { code: "INVALID_PLAYLIST_URL" }),
      };
    }
    throw e;
  }
  try {
    const meta = await fetchPlaylistMeta(playlistId);
    if (meta.public === false) {
      return {
        ok: false,
        response: err(c, "VALIDATION", "playlist must be public", {
          code: "PLAYLIST_NOT_AVAILABLE",
        }),
      };
    }
  } catch (e) {
    const mapped = mapSpotifyError(c, e);
    if (mapped) return { ok: false, response: mapped };
    throw e;
  }
  return { ok: true, playlistId, url };
}

listRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  // One query: every list the user is a member of, plus their role + the
  // member/item counts. Aggregates use COUNT(DISTINCT ...) so the cross-join
  // between members and items doesn't double-count.
  const rows = await executeRows<{
    id: string;
    type: string;
    name: string;
    emoji: string;
    color: string;
    description: string | null;
    owner_id: string;
    metadata: Record<string, unknown> | null;
    created_at: Date | string;
    updated_at: Date | string;
    my_role: string;
    member_count: number;
    item_count: number;
  }>(
    db,
    sql`
      SELECT
        l.id,
        l.type::text AS type,
        l.name,
        l.emoji,
        l.color,
        l.description,
        l.owner_id,
        l.metadata,
        l.created_at,
        l.updated_at,
        me.role::text AS my_role,
        (SELECT COUNT(*)::int FROM list_members m WHERE m.list_id = l.id) AS member_count,
        (SELECT COUNT(*)::int FROM items i WHERE i.list_id = l.id) AS item_count
      FROM lists l
      JOIN list_members me ON me.list_id = l.id AND me.user_id = ${userId}
      ORDER BY l.updated_at DESC
    `,
  );

  const summaries: ListSummary[] = rows.map((r) => ({
    id: r.id,
    type: r.type as ListSummary["type"],
    name: r.name,
    emoji: r.emoji,
    color: r.color as ListColor,
    description: r.description,
    ownerId: r.owner_id,
    metadata: (r.metadata ?? {}) as ListMetadata,
    createdAt: toIsoString(r.created_at),
    updatedAt: toIsoString(r.updated_at),
    role: r.my_role as MemberRole,
    memberCount: Number(r.member_count),
    itemCount: Number(r.item_count),
  }));

  return ok(c, { lists: summaries });
});

listRoutes.post("/", async (c) => {
  const parsed = await parseJsonBody(c, createListSchema);
  if (!parsed.ok) return parsed.response;
  const userId = c.get("userId");
  const db = getDb();
  const data = parsed.data;

  // album_shelf: validate the playlist URL up-front so we don't create
  // an orphan list if Spotify rejects it. The actual album fetch happens
  // inside the transaction below.
  let playlistMetadata: AlbumShelfListMetadata | null = null;
  if (data.type === "album_shelf") {
    if (!data.spotifyPlaylistUrl) {
      return err(c, "VALIDATION", "spotifyPlaylistUrl required for album_shelf lists");
    }
    const validated = await validatePlaylistUrl(c, data.spotifyPlaylistUrl);
    if (!validated.ok) return validated.response;
    playlistMetadata = {
      spotifyPlaylistUrl: validated.url,
      spotifyPlaylistId: validated.playlistId,
      lastRefreshedAt: null,
      lastRefreshedBy: null,
    };
  } else if (data.spotifyPlaylistUrl !== undefined) {
    return err(c, "VALIDATION", "spotifyPlaylistUrl only valid for album_shelf lists");
  }

  let created: DbList;
  try {
    created = await db.transaction(async (tx) => {
      const [list] = await tx
        .insert(lists)
        .values({
          type: data.type,
          name: data.name,
          emoji: data.emoji,
          color: data.color,
          description: data.description ?? null,
          ownerId: userId,
          metadata: playlistMetadata ?? {},
        })
        .returning();
      if (!list) throw new Error("list insert returned no row");
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
        payload: { name: list.name, type: list.type },
      });

      if (data.type === "album_shelf" && playlistMetadata) {
        const result = await refreshAlbumShelfItems({
          listId: list.id,
          userId,
          spotifyPlaylistId: playlistMetadata.spotifyPlaylistId,
          spotifyPlaylistUrl: playlistMetadata.spotifyPlaylistUrl,
          db: tx,
        });
        await recordEvent({
          db: tx,
          listId: list.id,
          actorId: userId,
          type: "album_shelf_refreshed",
          payload: { added: result.addedCount, source: result.source },
        });
        // Re-select so the returned shape reflects the updated metadata
        // (lastRefreshedAt populated by refreshAlbumShelfItems).
        const [refreshed] = await tx.select().from(lists).where(eq(lists.id, list.id)).limit(1);
        return refreshed ?? list;
      }
      return list;
    });
  } catch (e) {
    const mapped = mapSpotifyError(c, e);
    if (mapped) return mapped;
    throw e;
  }

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

  // Owners see real pending-invite rows (token omitted); non-owners
  // see an empty array. Spec §4.9: "Pending invites — shown if the
  // list has unaccepted email invites". v1 only has share-link
  // invites, but the same restriction applies — the share UX surface
  // is owner-only.
  const role = c.get("listMemberRole");
  const pendingInvites = role === "owner" ? await fetchPendingInvitesForList(listId) : [];

  return ok(c, {
    list: toListShape(list),
    members,
    pendingInvites,
  });
});

listRoutes.patch("/:id", requireListMember, async (c) => {
  const parsed = await parseJsonBody(c, updateListSchema);
  if (!parsed.ok) return parsed.response;
  const listId = c.req.param("id");
  const userId = c.get("userId");
  const role = c.get("listMemberRole");
  const db = getDb();
  const data = parsed.data;

  // Permission split (spec §3.5): owner-only for rename / emoji / color /
  // description; any member can patch metadata (the only metadata patch we
  // currently allow is album_shelf source URL change).
  const ownerOnlyKeys = (["name", "emoji", "color", "description"] as const).filter(
    (k) => data[k] !== undefined,
  );
  if (ownerOnlyKeys.length > 0 && role !== "owner") {
    return err(c, "FORBIDDEN", "owner-only patch fields", { keys: ownerOnlyKeys });
  }

  // Look up the current list to know its type (gates whether `metadata`
  // patches are allowed and what schema applies).
  const [existing] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
  if (!existing) return err(c, "NOT_FOUND", "list not found");

  const patch: Partial<DbList> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.emoji !== undefined) patch.emoji = data.emoji;
  if (data.color !== undefined) patch.color = data.color;
  if (data.description !== undefined) patch.description = data.description;

  let triggerAlbumShelfRefresh = false;
  let oldSourceUrl: string | null = null;
  let newPlaylistId: string | null = null;
  let newSourceUrl: string | null = null;
  if (data.metadata !== undefined) {
    if (existing.type !== "album_shelf") {
      return err(c, "VALIDATION", "metadata patch only supported for album_shelf lists");
    }
    const v = albumShelfListMetadataPatchSchema.safeParse(data.metadata);
    if (!v.success) {
      return err(c, "VALIDATION", "invalid metadata patch", v.error.issues);
    }
    if (v.data.spotifyPlaylistUrl !== undefined) {
      const validated = await validatePlaylistUrl(c, v.data.spotifyPlaylistUrl);
      if (!validated.ok) return validated.response;

      const prevMeta = (existing.metadata ?? {}) as Record<string, unknown>;
      oldSourceUrl =
        typeof prevMeta.spotifyPlaylistUrl === "string" ? prevMeta.spotifyPlaylistUrl : null;
      newSourceUrl = validated.url;
      newPlaylistId = validated.playlistId;
      triggerAlbumShelfRefresh = true;
      patch.metadata = {
        ...prevMeta,
        spotifyPlaylistUrl: validated.url,
        spotifyPlaylistId: validated.playlistId,
      };
    }
  }

  if (
    data.name === undefined &&
    data.emoji === undefined &&
    data.color === undefined &&
    data.description === undefined &&
    !triggerAlbumShelfRefresh
  ) {
    // Nothing actionable in the patch (e.g. metadata blob without
    // spotifyPlaylistUrl). Return the row as-is.
    return ok(c, { list: toListShape(existing) });
  }

  const [updated] = await db.update(lists).set(patch).where(eq(lists.id, listId)).returning();
  if (!updated) return err(c, "NOT_FOUND", "list not found");

  if (triggerAlbumShelfRefresh && newPlaylistId && newSourceUrl) {
    try {
      const result = await refreshAlbumShelfItems({
        listId,
        userId,
        spotifyPlaylistId: newPlaylistId,
        spotifyPlaylistUrl: newSourceUrl,
        db,
      });
      await recordEvent({
        listId,
        actorId: userId,
        type: "album_shelf_source_changed",
        payload: { from: oldSourceUrl ?? "", to: newSourceUrl },
      });
      await recordEvent({
        listId,
        actorId: userId,
        type: "album_shelf_refreshed",
        payload: { added: result.addedCount, source: result.source },
      });
      const [reread] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
      return ok(c, { list: toListShape(reread ?? updated) });
    } catch (e) {
      const mapped = mapSpotifyError(c, e);
      if (mapped) return mapped;
      throw e;
    }
  }

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
  const db = getDb();

  // Album shelves return a typed `{ ordered, detected }` shape — section
  // assignment + sort happen server-side per spec §7.2 so the client
  // doesn't have to filter/sort by metadata.position.
  const [parent] = await db
    .select({ type: lists.type })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  if (!parent) return err(c, "NOT_FOUND", "list not found");
  if (parent.type === "album_shelf") {
    const split = await fetchAlbumShelfItems(listId);
    return ok(c, split);
  }

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
    const parsed = await parseJsonBody(c, createItemSchema);
    if (!parsed.ok) return parsed.response;
    const listId = c.req.param("id");
    const userId = c.get("userId");

    // album_shelf items only enter via refresh — manual add isn't a UX entry
    // point on the client and accepting it here would let stale clients
    // smuggle in rows that don't satisfy the type's metadata invariants.
    const db = getDb();
    const [parent] = await db
      .select({ type: lists.type })
      .from(lists)
      .where(eq(lists.id, listId))
      .limit(1);
    if (parent?.type === "album_shelf") {
      return err(c, "VALIDATION", "items cannot be added manually to an album_shelf list");
    }

    let item: Awaited<ReturnType<typeof createItem>>;
    try {
      item = await createItem(listId, userId, parsed.data);
    } catch (e) {
      if (e instanceof ItemMetadataError) {
        return err(c, "VALIDATION", "invalid metadata for list type", e.issues);
      }
      throw e;
    }
    return ok(c, { item }, 201);
  },
);

// --- Album-shelf refresh ---
//
// Pulls the current playlist from Spotify and adds any new (list_id,
// spotifyAlbumId) rows as detected items. Pure-additive: existing rows
// (ordered or detected) stay even if their tracks left the playlist.
// Member-level (any member can refresh).

listRoutes.post(
  "/:id/refresh",
  requireListMember,
  rateLimit({
    family: "v1.album-shelf.refresh",
    limit: 30,
    windowSec: 60,
    key: (c) => c.get("userId") ?? null,
  }),
  async (c) => {
    const listId = c.req.param("id");
    const userId = c.get("userId");
    const db = getDb();
    const [list] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
    if (!list) return err(c, "NOT_FOUND", "list not found");
    if (list.type !== "album_shelf") {
      return err(c, "VALIDATION", "refresh only supported for album_shelf lists");
    }

    let meta: AlbumShelfListMetadata;
    try {
      meta = asAlbumShelfMetadata(list.metadata);
    } catch {
      return err(c, "VALIDATION", "album shelf playlist not configured");
    }

    let result: Awaited<ReturnType<typeof refreshAlbumShelfItems>>;
    try {
      result = await refreshAlbumShelfItems({
        listId,
        userId,
        spotifyPlaylistId: meta.spotifyPlaylistId,
        spotifyPlaylistUrl: meta.spotifyPlaylistUrl,
        db,
      });
    } catch (e) {
      const mapped = mapSpotifyError(c, e);
      if (mapped) return mapped;
      throw e;
    }

    await recordEvent({
      listId,
      actorId: userId,
      type: "album_shelf_refreshed",
      payload: { added: result.addedCount, source: result.source },
    });

    const split = await fetchAlbumShelfItems(listId);
    return ok(c, {
      ...split,
      refreshedAt: result.refreshedAt.toISOString(),
      refreshedBy: userId,
      addedCount: result.addedCount,
    });
  },
);
