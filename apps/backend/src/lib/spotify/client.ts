import { eq } from "drizzle-orm";
import { getDb } from "../../db/client.js";
import { type DbSpotifyAccount, spotifyAccounts } from "../../db/schema.js";
import { logger } from "../logger.js";
import { refreshAccessToken } from "./auth.js";

const SPOTIFY_API = "https://api.spotify.com/v1";
const REFRESH_SAFETY_WINDOW_MS = 60_000; // refresh ~1 min before expiry

export class SpotifyApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, message?: string) {
    super(message ?? `spotify api ${status}: ${body.slice(0, 200)}`);
    this.name = "SpotifyApiError";
    this.status = status;
    this.body = body;
  }
}

export class SpotifyNotConnectedError extends Error {
  constructor() {
    super("user has not connected spotify");
    this.name = "SpotifyNotConnectedError";
  }
}

async function loadAccount(userId: string): Promise<DbSpotifyAccount> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(spotifyAccounts)
    .where(eq(spotifyAccounts.userId, userId))
    .limit(1);
  if (!row) throw new SpotifyNotConnectedError();
  return row;
}

async function ensureFreshToken(account: DbSpotifyAccount): Promise<DbSpotifyAccount> {
  const expiresMs = account.expiresAt.getTime();
  if (expiresMs - Date.now() > REFRESH_SAFETY_WINDOW_MS) {
    return account;
  }
  logger.debug("refreshing spotify access token", { userId: account.userId });
  const refreshed = await refreshAccessToken(account.refreshToken);
  const db = getDb();
  const [updated] = await db
    .update(spotifyAccounts)
    .set({
      accessToken: refreshed.access_token,
      // Spotify rotates refresh tokens occasionally; keep the new one when
      // returned, otherwise keep the existing one.
      refreshToken: refreshed.refresh_token ?? account.refreshToken,
      expiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      scope: refreshed.scope,
      updatedAt: new Date(),
    })
    .where(eq(spotifyAccounts.userId, account.userId))
    .returning();
  return updated ?? account;
}

interface SpotifyRequestInit {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/**
 * Issue a Spotify Web API request as the given workshop user. Handles token
 * refresh, query param encoding, and 204 (no-content) responses.
 *
 * Returns `null` for 204 responses; otherwise returns parsed JSON. The caller
 * is responsible for type-narrowing the result (zod or a hand-rolled guard).
 */
async function spotifyRequest<T>(
  userId: string,
  path: string,
  init: SpotifyRequestInit = {},
): Promise<T> {
  const account = await ensureFreshToken(await loadAccount(userId));
  return spotifyRequestWithToken<T>(account.accessToken, path, init);
}

async function spotifyRequestWithToken<T>(
  accessToken: string,
  path: string,
  init: SpotifyRequestInit = {},
): Promise<T> {
  const url = new URL(`${SPOTIFY_API}${path}`);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const fetchInit: RequestInit = { method: init.method ?? "GET", headers };
  if (init.body !== undefined) fetchInit.body = JSON.stringify(init.body);
  const res = await fetch(url, fetchInit);

  if (res.status === 204) return null as T;

  const text = await res.text();
  if (!res.ok) {
    throw new SpotifyApiError(res.status, text);
  }
  if (text.length === 0) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SpotifyApiError(res.status, text, "spotify response was not valid json");
  }
}

// --- Typed Spotify response shapes ---
//
// These cover only the fields this app reads. Extend as features grow.

interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

interface SpotifyArtistRef {
  id: string;
  name: string;
}

export interface SpotifyAlbumApi {
  id: string;
  name: string;
  artists: SpotifyArtistRef[];
  images: SpotifyImage[];
  release_date: string;
  total_tracks: number;
  external_urls: { spotify: string };
}

export interface SpotifyTrackApi {
  id: string;
  name: string;
  duration_ms: number;
  artists: SpotifyArtistRef[];
  album: {
    id: string;
    name: string;
    images: SpotifyImage[];
  };
  external_urls: { spotify: string };
}

export interface SpotifyPlaylistApi {
  id: string;
  name: string;
  description: string | null;
  images: SpotifyImage[];
  owner: { display_name: string | null; id: string };
  tracks: { total: number };
  external_urls: { spotify: string };
}

interface SpotifyPlaylistTrackItem {
  added_at: string | null;
  track: SpotifyTrackApi | null;
}

interface SpotifyPaging<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next: string | null;
}

export interface SpotifyMe {
  id: string;
  display_name: string | null;
  email: string | null;
}

interface SpotifyCurrentlyPlaying {
  is_playing: boolean;
  progress_ms: number | null;
  item: SpotifyTrackApi | null;
}

interface SpotifyRecentlyPlayedItem {
  played_at: string;
  track: SpotifyTrackApi;
}

// --- High-level helpers ---

export function fetchMeWithToken(accessToken: string): Promise<SpotifyMe> {
  return spotifyRequestWithToken<SpotifyMe>(accessToken, "/me");
}

export function searchAlbums(
  userId: string,
  query: string,
  limit: number,
): Promise<{ albums: SpotifyPaging<SpotifyAlbumApi> }> {
  return spotifyRequest<{ albums: SpotifyPaging<SpotifyAlbumApi> }>(userId, "/search", {
    query: { q: query, type: "album", limit },
  });
}

export function fetchAlbum(userId: string, albumId: string): Promise<SpotifyAlbumApi> {
  return spotifyRequest<SpotifyAlbumApi>(userId, `/albums/${albumId}`);
}

export function fetchCurrentlyPlaying(userId: string): Promise<SpotifyCurrentlyPlaying | null> {
  return spotifyRequest<SpotifyCurrentlyPlaying | null>(userId, "/me/player/currently-playing");
}

export function fetchRecentlyPlayed(
  userId: string,
  limit: number,
): Promise<SpotifyPaging<SpotifyRecentlyPlayedItem>> {
  return spotifyRequest<SpotifyPaging<SpotifyRecentlyPlayedItem>>(
    userId,
    "/me/player/recently-played",
    { query: { limit } },
  );
}

export function fetchUserPlaylists(
  userId: string,
  limit: number,
  offset: number,
): Promise<SpotifyPaging<SpotifyPlaylistApi>> {
  return spotifyRequest<SpotifyPaging<SpotifyPlaylistApi>>(userId, "/me/playlists", {
    query: { limit, offset },
  });
}

export function fetchPlaylist(userId: string, playlistId: string): Promise<SpotifyPlaylistApi> {
  return spotifyRequest<SpotifyPlaylistApi>(userId, `/playlists/${playlistId}`);
}

export function fetchPlaylistTracks(
  userId: string,
  playlistId: string,
  limit: number,
  offset: number,
): Promise<SpotifyPaging<SpotifyPlaylistTrackItem>> {
  return spotifyRequest<SpotifyPaging<SpotifyPlaylistTrackItem>>(
    userId,
    `/playlists/${playlistId}/tracks`,
    { query: { limit, offset } },
  );
}
