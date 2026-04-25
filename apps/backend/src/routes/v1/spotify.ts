import type {
  SavedAlbum,
  SavedAlbumListResponse,
  SavedAlbumResponse,
  SpotifyAlbumSearchResponse,
  SpotifyAlbumSummary,
  SpotifyAuthorizeResponse,
  SpotifyConnectionStatus,
  SpotifyNowPlaying,
  SpotifyPlaylistListResponse,
  SpotifyPlaylistSummary,
  SpotifyPlaylistTracksResponse,
  SpotifyRecentListensResponse,
  SpotifyTrackSummary,
  SyncPlaylistAlbumsResponse,
} from "@workshop/shared";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import {
  type DbSpotifyAlbumSave,
  spotifyAccounts,
  spotifyAlbumSaves,
  spotifyOauthStates,
} from "../../db/schema.js";
import { getConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { err, ok } from "../../lib/response.js";
import {
  buildAuthorizeUrl,
  deriveCodeChallenge,
  exchangeCodeForToken,
  generateCodeVerifier,
  generateState,
  SpotifyAuthError,
  type SpotifyTokenResponse,
} from "../../lib/spotify/auth.js";
import {
  fetchAlbum,
  fetchCurrentlyPlaying,
  fetchMeWithToken,
  fetchPlaylist,
  fetchPlaylistTracks,
  fetchRecentlyPlayed,
  fetchUserPlaylists,
  type SpotifyAlbumApi,
  SpotifyApiError,
  type SpotifyMe,
  SpotifyNotConnectedError,
  type SpotifyPlaylistApi,
  type SpotifyTrackApi,
  searchAlbums,
} from "../../lib/spotify/client.js";
import { SPOTIFY_SCOPE_STRING } from "../../lib/spotify/scopes.js";
import { requireAuth } from "../../middleware/auth.js";

export const spotifyRoutes = new Hono();

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// /v1/spotify/auth/callback handles the redirect from Spotify and never carries
// a session bearer token (the user's browser does the redirect, not the app).
// All other routes require auth.
spotifyRoutes.use("*", async (c, next) => {
  if (c.req.path.endsWith("/v1/spotify/auth/callback")) {
    return next();
  }
  return requireAuth(c, next);
});

function ensureConfigured() {
  const c = getConfig();
  if (!c.spotifyClientId || !c.spotifyRedirectUri) {
    throw new SpotifyConfigError();
  }
}

class SpotifyConfigError extends Error {
  constructor() {
    super("spotify integration is not configured on this deployment");
    this.name = "SpotifyConfigError";
  }
}

// --- helpers ---

function bestImage(images: { url: string; width: number | null }[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  // Spotify returns largest first; pick a mid-size one if available.
  const mid = images.find((i) => (i.width ?? 0) > 200 && (i.width ?? 0) < 500);
  return (mid ?? images[0])?.url ?? null;
}

function albumApiToSummary(a: SpotifyAlbumApi): SpotifyAlbumSummary {
  return {
    spotifyAlbumId: a.id,
    name: a.name,
    artists: a.artists.map((ar) => ar.name),
    imageUrl: bestImage(a.images),
    releaseDate: a.release_date ?? null,
    totalTracks: a.total_tracks ?? null,
    spotifyUrl: a.external_urls?.spotify ?? null,
  };
}

function trackApiToSummary(t: SpotifyTrackApi): SpotifyTrackSummary {
  return {
    spotifyTrackId: t.id,
    name: t.name,
    durationMs: t.duration_ms,
    artists: t.artists.map((a) => a.name),
    album: {
      spotifyAlbumId: t.album.id,
      name: t.album.name,
      imageUrl: bestImage(t.album.images),
    },
    spotifyUrl: t.external_urls?.spotify ?? null,
  };
}

function savedRowToShape(row: DbSpotifyAlbumSave): SavedAlbum {
  return {
    spotifyAlbumId: row.spotifyAlbumId,
    name: row.name,
    artists: Array.isArray(row.artists) ? (row.artists as string[]) : [],
    imageUrl: row.imageUrl,
    releaseDate: row.releaseDate,
    totalTracks: row.totalTracks,
    spotifyUrl: row.spotifyUrl,
    note: row.note,
    savedAt: row.createdAt.toISOString(),
  };
}

function handleSpotifyError(c: Context, e: unknown) {
  if (e instanceof SpotifyConfigError) {
    return err(c, "INTERNAL", e.message, undefined, 503);
  }
  if (e instanceof SpotifyNotConnectedError) {
    return err(c, "FORBIDDEN", "spotify not connected for this account");
  }
  if (e instanceof SpotifyApiError) {
    if (e.status === 401 || e.status === 403) {
      return err(c, "FORBIDDEN", "spotify rejected the request — reconnect may be required");
    }
    if (e.status === 429) {
      return err(c, "RATE_LIMITED", "spotify rate limit");
    }
    if (e.status === 404) {
      return err(c, "NOT_FOUND", "spotify resource not found");
    }
    logger.error("spotify api error", { error: e });
    return err(c, "INTERNAL", "spotify api error");
  }
  if (e instanceof SpotifyAuthError) {
    logger.error("spotify auth error", { error: e });
    return err(c, "INTERNAL", "spotify auth error");
  }
  throw e;
}

// --- OAuth: status, authorize, callback, disconnect ---

spotifyRoutes.get("/auth/status", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const [row] = await db
    .select()
    .from(spotifyAccounts)
    .where(eq(spotifyAccounts.userId, userId))
    .limit(1);
  const status: SpotifyConnectionStatus = row
    ? {
        connected: true,
        spotifyUserId: row.spotifyUserId,
        spotifyDisplayName: row.spotifyDisplayName,
        scope: row.scope,
        connectedAt: row.createdAt.toISOString(),
      }
    : {
        connected: false,
        spotifyUserId: null,
        spotifyDisplayName: null,
        scope: null,
        connectedAt: null,
      };
  return ok(c, status);
});

const authorizeQuerySchema = z.object({
  // Optional override for where the user lands after the callback. Useful so
  // mobile can request `workshop://spotify/connected` while web requests its
  // dev origin. Defaults to SPOTIFY_APP_REDIRECT_URI.
  appRedirect: z.string().url().optional(),
});

spotifyRoutes.post("/auth/authorize", async (c) => {
  try {
    ensureConfigured();
  } catch (e) {
    return handleSpotifyError(c, e);
  }
  const userId = c.get("userId");
  const parsed = authorizeQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid query", parsed.error.issues);
  }
  const verifier = generateCodeVerifier();
  const state = generateState();
  const challenge = deriveCodeChallenge(verifier);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  const db = getDb();
  // Best-effort cleanup of expired states for this user; cheap and avoids a
  // background job. Concurrent inserts won't collide because `state` is random.
  await db.delete(spotifyOauthStates).where(lt(spotifyOauthStates.expiresAt, new Date()));
  await db.insert(spotifyOauthStates).values({
    state,
    userId,
    codeVerifier: verifier,
    appRedirect: parsed.data.appRedirect ?? null,
    expiresAt,
  });
  const authorizeUrl = buildAuthorizeUrl({ state, codeChallenge: challenge });
  const body: SpotifyAuthorizeResponse = { authorizeUrl, state };
  return ok(c, body);
});

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

// Helper used by the callback to build a small browser-safe redirect URL with
// success/failure flags appended. The Spotify side of the OAuth dance never
// has a bearer token — we resolve the user via the `state` row.
function appendQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

spotifyRoutes.get("/auth/callback", async (c) => {
  const cfg = getConfig();
  if (!cfg.spotifyClientId || !cfg.spotifyRedirectUri) {
    return c.text("Spotify integration is not configured.", 503);
  }
  const parsed = callbackQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.text("invalid callback query", 400);
  }
  const { code, state, error, error_description } = parsed.data;
  const db = getDb();

  if (error) {
    logger.info("spotify callback returned error", { error, error_description });
    if (state) {
      const [row] = await db
        .select()
        .from(spotifyOauthStates)
        .where(eq(spotifyOauthStates.state, state))
        .limit(1);
      await db.delete(spotifyOauthStates).where(eq(spotifyOauthStates.state, state));
      const target = row?.appRedirect ?? cfg.spotifyAppRedirectUri;
      if (target) {
        return c.redirect(appendQuery(target, { spotify: "error", reason: error }));
      }
    }
    return c.text(`Spotify authorization failed: ${error}`, 400);
  }

  if (!code || !state) return c.text("missing code or state", 400);

  const [stateRow] = await db
    .select()
    .from(spotifyOauthStates)
    .where(eq(spotifyOauthStates.state, state))
    .limit(1);
  if (!stateRow) return c.text("unknown or expired state", 400);
  await db.delete(spotifyOauthStates).where(eq(spotifyOauthStates.state, state));
  if (stateRow.expiresAt.getTime() < Date.now()) {
    return c.text("state expired", 400);
  }

  let token: SpotifyTokenResponse;
  try {
    token = await exchangeCodeForToken(code, stateRow.codeVerifier);
  } catch (e) {
    logger.error("spotify token exchange failed", { error: e });
    const target = stateRow.appRedirect ?? cfg.spotifyAppRedirectUri;
    if (target) {
      return c.redirect(appendQuery(target, { spotify: "error", reason: "token_exchange" }));
    }
    return c.text("token exchange failed", 502);
  }

  let me: SpotifyMe;
  try {
    me = await fetchMeWithToken(token.access_token);
  } catch (e) {
    logger.error("spotify /me failed during callback", { error: e });
    return c.text("failed to read Spotify profile", 502);
  }

  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  // Spotify only returns a refresh token on first authorization for some flows;
  // PKCE always returns one. Guard regardless.
  if (!token.refresh_token) {
    logger.error("spotify token response missing refresh_token", { sub: me.id });
    return c.text("Spotify did not return a refresh token", 502);
  }

  await db
    .insert(spotifyAccounts)
    .values({
      userId: stateRow.userId,
      spotifyUserId: me.id,
      spotifyDisplayName: me.display_name,
      scope: token.scope,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: spotifyAccounts.userId,
      set: {
        spotifyUserId: me.id,
        spotifyDisplayName: me.display_name,
        scope: token.scope,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        updatedAt: new Date(),
      },
    });

  logger.info("spotify connected", { userId: stateRow.userId, spotifyUserId: me.id });

  const target = stateRow.appRedirect ?? cfg.spotifyAppRedirectUri;
  if (target) {
    return c.redirect(appendQuery(target, { spotify: "connected" }));
  }
  return c.text(
    `Connected as ${me.display_name ?? me.id}. You can close this tab and return to the app.`,
  );
});

spotifyRoutes.delete("/auth", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  await db.delete(spotifyAccounts).where(eq(spotifyAccounts.userId, userId));
  return ok(c, { ok: true });
});

// --- Search ---

const searchQuerySchema = z.object({
  q: z.string().min(1, "q required").max(200),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

spotifyRoutes.get("/albums/search", async (c) => {
  const parsed = searchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid query", parsed.error.issues);
  }
  const userId = c.get("userId");
  try {
    const data = await searchAlbums(userId, parsed.data.q, parsed.data.limit ?? 20);
    const body: SpotifyAlbumSearchResponse = {
      query: parsed.data.q,
      results: data.albums.items.map(albumApiToSummary),
    };
    return ok(c, body);
  } catch (e) {
    return handleSpotifyError(c, e);
  }
});

// --- Saved albums (the "album list" feature) ---

spotifyRoutes.get("/albums", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const rows = await db
    .select()
    .from(spotifyAlbumSaves)
    .where(eq(spotifyAlbumSaves.userId, userId))
    .orderBy(desc(spotifyAlbumSaves.createdAt));
  const body: SavedAlbumListResponse = { albums: rows.map(savedRowToShape) };
  return ok(c, body);
});

const saveAlbumSchema = z.object({
  spotifyAlbumId: z.string().min(1).max(64),
  note: z
    .string()
    .max(1000)
    .transform((s) => s.trim())
    .optional(),
});

spotifyRoutes.post("/albums", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return err(c, "VALIDATION", "invalid json body");
  }
  const parsed = saveAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid request", parsed.error.issues);
  }
  const userId = c.get("userId");
  let album: SpotifyAlbumApi;
  try {
    album = await fetchAlbum(userId, parsed.data.spotifyAlbumId);
  } catch (e) {
    return handleSpotifyError(c, e);
  }
  const summary = albumApiToSummary(album);

  const db = getDb();
  const [row] = await db
    .insert(spotifyAlbumSaves)
    .values({
      userId,
      spotifyAlbumId: summary.spotifyAlbumId,
      name: summary.name,
      artists: summary.artists,
      imageUrl: summary.imageUrl,
      releaseDate: summary.releaseDate,
      totalTracks: summary.totalTracks,
      spotifyUrl: summary.spotifyUrl,
      note: parsed.data.note ?? null,
    })
    .onConflictDoUpdate({
      target: [spotifyAlbumSaves.userId, spotifyAlbumSaves.spotifyAlbumId],
      // Keep the original savedAt; refresh denormalised metadata so albums
      // re-saved later pick up edited names/cover art.
      set: {
        name: summary.name,
        artists: summary.artists,
        imageUrl: summary.imageUrl,
        releaseDate: summary.releaseDate,
        totalTracks: summary.totalTracks,
        spotifyUrl: summary.spotifyUrl,
        // Only overwrite the note when the caller explicitly sent one.
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      },
    })
    .returning();
  if (!row) return err(c, "INTERNAL", "save returned no row");
  const resp: SavedAlbumResponse = { album: savedRowToShape(row) };
  return ok(c, resp, 201);
});

const updateSavedAlbumSchema = z
  .object({
    note: z
      .union([
        z
          .string()
          .max(1000)
          .transform((s) => s.trim()),
        z.null(),
      ])
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "at least one field required");

spotifyRoutes.patch("/albums/:spotifyAlbumId", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return err(c, "VALIDATION", "invalid json body");
  }
  const parsed = updateSavedAlbumSchema.safeParse(body);
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid request", parsed.error.issues);
  }
  const userId = c.get("userId");
  const spotifyAlbumId = c.req.param("spotifyAlbumId");
  const db = getDb();
  const patch: Partial<DbSpotifyAlbumSave> = {};
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;
  const [row] = await db
    .update(spotifyAlbumSaves)
    .set(patch)
    .where(
      and(
        eq(spotifyAlbumSaves.userId, userId),
        eq(spotifyAlbumSaves.spotifyAlbumId, spotifyAlbumId),
      ),
    )
    .returning();
  if (!row) return err(c, "NOT_FOUND", "album not in your saved list");
  const resp: SavedAlbumResponse = { album: savedRowToShape(row) };
  return ok(c, resp);
});

spotifyRoutes.delete("/albums/:spotifyAlbumId", async (c) => {
  const userId = c.get("userId");
  const spotifyAlbumId = c.req.param("spotifyAlbumId");
  const db = getDb();
  const deleted = await db
    .delete(spotifyAlbumSaves)
    .where(
      and(
        eq(spotifyAlbumSaves.userId, userId),
        eq(spotifyAlbumSaves.spotifyAlbumId, spotifyAlbumId),
      ),
    )
    .returning({ id: spotifyAlbumSaves.spotifyAlbumId });
  if (deleted.length === 0) return err(c, "NOT_FOUND", "album not in your saved list");
  return ok(c, { ok: true });
});

// --- Now playing + recent listens ---

spotifyRoutes.get("/now-playing", async (c) => {
  const userId = c.get("userId");
  try {
    const data = await fetchCurrentlyPlaying(userId);
    if (!data?.item) {
      const resp: SpotifyNowPlaying = { isPlaying: false, progressMs: null, track: null };
      return ok(c, resp);
    }
    const resp: SpotifyNowPlaying = {
      isPlaying: data.is_playing,
      progressMs: data.progress_ms,
      track: trackApiToSummary(data.item),
    };
    return ok(c, resp);
  } catch (e) {
    return handleSpotifyError(c, e);
  }
});

const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

spotifyRoutes.get("/recent", async (c) => {
  const userId = c.get("userId");
  const parsed = recentQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid query", parsed.error.issues);
  }
  try {
    const data = await fetchRecentlyPlayed(userId, parsed.data.limit ?? 20);
    const resp: SpotifyRecentListensResponse = {
      items: data.items.map((entry) => ({
        playedAt: entry.played_at,
        track: trackApiToSummary(entry.track),
      })),
    };
    return ok(c, resp);
  } catch (e) {
    return handleSpotifyError(c, e);
  }
});

// --- Playlists + sync ---

const playlistListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

spotifyRoutes.get("/playlists", async (c) => {
  const userId = c.get("userId");
  const parsed = playlistListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid query", parsed.error.issues);
  }
  try {
    const data = await fetchUserPlaylists(userId, parsed.data.limit ?? 50, parsed.data.offset ?? 0);
    const playlists: SpotifyPlaylistSummary[] = data.items.map((p) => ({
      spotifyPlaylistId: p.id,
      name: p.name,
      description: p.description,
      imageUrl: bestImage(p.images),
      ownerDisplayName: p.owner.display_name,
      trackCount: p.tracks.total,
      spotifyUrl: p.external_urls?.spotify ?? null,
    }));
    const resp: SpotifyPlaylistListResponse = { playlists };
    return ok(c, resp);
  } catch (e) {
    return handleSpotifyError(c, e);
  }
});

const playlistTracksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

spotifyRoutes.get("/playlists/:id/tracks", async (c) => {
  const userId = c.get("userId");
  const playlistId = c.req.param("id");
  const parsed = playlistTracksQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return err(c, "VALIDATION", "invalid query", parsed.error.issues);
  }
  try {
    const data = await fetchPlaylistTracks(
      userId,
      playlistId,
      parsed.data.limit ?? 100,
      parsed.data.offset ?? 0,
    );
    const tracks: SpotifyTrackSummary[] = data.items
      .map((entry) => entry.track)
      .filter((t): t is SpotifyTrackApi => t !== null)
      .map(trackApiToSummary);
    const resp: SpotifyPlaylistTracksResponse = {
      playlistId,
      total: data.total,
      tracks,
    };
    return ok(c, resp);
  } catch (e) {
    return handleSpotifyError(c, e);
  }
});

// "Sync" — bulk-save every unique album in a Spotify playlist into the user's
// saved-albums list. Pages through up to ~1000 tracks (10 * 100); larger
// playlists get truncated rather than risking a Lambda timeout. Future work:
// queue this for async processing.
spotifyRoutes.post("/playlists/:id/sync-albums", async (c) => {
  const userId = c.get("userId");
  const playlistId = c.req.param("id");
  let playlistMeta: SpotifyPlaylistApi;
  try {
    playlistMeta = await fetchPlaylist(userId, playlistId);
  } catch (e) {
    return handleSpotifyError(c, e);
  }

  const seen = new Map<string, SpotifyAlbumSummary>();
  const total = Math.min(playlistMeta.tracks.total ?? 0, 1000);
  let offset = 0;
  try {
    while (offset < total) {
      const page = await fetchPlaylistTracks(userId, playlistId, 100, offset);
      for (const entry of page.items) {
        const t = entry.track;
        if (!t) continue;
        if (!t.album?.id || seen.has(t.album.id)) continue;
        seen.set(t.album.id, {
          spotifyAlbumId: t.album.id,
          name: t.album.name,
          artists: t.artists.map((a) => a.name),
          imageUrl: bestImage(t.album.images),
          releaseDate: null,
          totalTracks: null,
          spotifyUrl: null,
        });
      }
      if (page.items.length === 0) break;
      offset += page.items.length;
    }
  } catch (e) {
    return handleSpotifyError(c, e);
  }

  const albumIds = [...seen.keys()];
  if (albumIds.length === 0) {
    const resp: SyncPlaylistAlbumsResponse = {
      playlistId,
      uniqueAlbumCount: 0,
      newlySavedCount: 0,
      alreadySavedCount: 0,
      albums: [],
    };
    return ok(c, resp);
  }

  const db = getDb();
  const existing = await db
    .select({ spotifyAlbumId: spotifyAlbumSaves.spotifyAlbumId })
    .from(spotifyAlbumSaves)
    .where(
      and(
        eq(spotifyAlbumSaves.userId, userId),
        inArray(spotifyAlbumSaves.spotifyAlbumId, albumIds),
      ),
    );
  const existingSet = new Set(existing.map((r) => r.spotifyAlbumId));

  const toInsert = albumIds
    .filter((id) => !existingSet.has(id))
    .map((id) => {
      const a = seen.get(id);
      if (!a) throw new Error("album missing from seen map");
      return {
        userId,
        spotifyAlbumId: a.spotifyAlbumId,
        name: a.name,
        artists: a.artists,
        imageUrl: a.imageUrl,
        releaseDate: a.releaseDate,
        totalTracks: a.totalTracks,
        spotifyUrl: a.spotifyUrl,
        note: null,
      };
    });

  let insertedRows: DbSpotifyAlbumSave[] = [];
  if (toInsert.length > 0) {
    insertedRows = await db
      .insert(spotifyAlbumSaves)
      .values(toInsert)
      .onConflictDoNothing()
      .returning();
  }
  // Re-fetch the full set so the response includes existing rows too.
  const allRows = await db
    .select()
    .from(spotifyAlbumSaves)
    .where(
      and(
        eq(spotifyAlbumSaves.userId, userId),
        inArray(spotifyAlbumSaves.spotifyAlbumId, albumIds),
      ),
    )
    .orderBy(desc(spotifyAlbumSaves.createdAt));
  const resp: SyncPlaylistAlbumsResponse = {
    playlistId,
    uniqueAlbumCount: albumIds.length,
    newlySavedCount: insertedRows.length,
    alreadySavedCount: existingSet.size,
    albums: allRows.map(savedRowToShape),
  };
  logger.info("spotify playlist synced to album list", {
    userId,
    playlistId,
    uniqueAlbumCount: resp.uniqueAlbumCount,
    newlySavedCount: resp.newlySavedCount,
  });
  return ok(c, resp);
});

// Used as a tiny health/diagnostic for the integration. The Spotify API can
// be mocked in tests by stubbing fetch — keep this last so it's easy to find.
spotifyRoutes.get("/scopes", (c) => ok(c, { scope: SPOTIFY_SCOPE_STRING }));
