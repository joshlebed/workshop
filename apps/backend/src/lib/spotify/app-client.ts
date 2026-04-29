// Spotify Web API client using the Client Credentials grant. App-level token,
// no per-user OAuth — enough for reading public playlists, which is the
// only access pattern Album Shelf needs. See docs/album-shelf.md §6.
//
// Token is cached in module scope so each warm Lambda container amortizes
// the ~50ms token fetch across hundreds of API calls. On a 401 we
// invalidate and retry once.

import { getConfig } from "../config.js";
import { logger } from "../logger.js";

export class SpotifyConfigError extends Error {
  constructor() {
    super("spotify client credentials not configured");
    this.name = "SpotifyConfigError";
  }
}

export class SpotifyAuthError extends Error {
  constructor(message = "spotify auth failed") {
    super(message);
    this.name = "SpotifyAuthError";
  }
}

export class SpotifyApiError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `spotify request failed (${status})`);
    this.name = "SpotifyApiError";
    this.status = status;
  }
}

export class PlaylistNotAvailableError extends Error {
  constructor(message = "playlist is private or unavailable") {
    super(message);
    this.name = "PlaylistNotAvailableError";
  }
}

interface CachedToken {
  value: string;
  expiresAt: number; // ms epoch
}

let cachedToken: CachedToken | null = null;

/** Reset the in-process token cache. Test-only. */
export function resetTokenCacheForTesting() {
  cachedToken = null;
}

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_ROOT = "https://api.spotify.com/v1";
const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 60s before expiry

type Fetcher = typeof fetch;

async function fetchAppToken(fetcher: Fetcher): Promise<CachedToken> {
  const { spotifyClientId, spotifyClientSecret } = getConfig();
  if (!spotifyClientId || !spotifyClientSecret) throw new SpotifyConfigError();

  const basic = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64");
  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("spotify token fetch failed", { status: res.status, body: text });
    throw new SpotifyAuthError(`token endpoint returned ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  if (
    typeof json !== "object" ||
    json === null ||
    typeof (json as Record<string, unknown>).access_token !== "string" ||
    typeof (json as Record<string, unknown>).expires_in !== "number"
  ) {
    throw new SpotifyAuthError("token response malformed");
  }
  const accessToken = (json as { access_token: string }).access_token;
  const expiresIn = (json as { expires_in: number }).expires_in;
  return {
    value: accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function getAppToken(fetcher: Fetcher = fetch): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.value;
  }
  cachedToken = await fetchAppToken(fetcher);
  return cachedToken.value;
}

interface RequestOptions {
  fetcher?: Fetcher;
}

async function spotifyGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const url = path.startsWith("http") ? path : `${API_ROOT}${path}`;

  const doRequest = async (token: string) =>
    fetcher(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

  let token = await getAppToken(fetcher);
  let res = await doRequest(token);

  if (res.status === 401) {
    // Token rotated under us — re-mint and try once more.
    cachedToken = null;
    token = await getAppToken(fetcher);
    res = await doRequest(token);
  }

  if (res.status === 404) {
    throw new PlaylistNotAvailableError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn("spotify api error", { status: res.status, path, body: text.slice(0, 500) });
    throw new SpotifyApiError(res.status);
  }
  return (await res.json()) as T;
}

// --- Spotify wire types (subset; we only model the fields we read) ---

interface SpotifyImage {
  url: string;
  height?: number | null;
  width?: number | null;
}

interface SpotifyPlaylistMeta {
  id: string;
  name: string;
  public: boolean | null;
  owner: { display_name?: string | null } | null;
  tracks: { total: number };
}

interface SpotifyPlaylistTrackPage {
  items: Array<{
    track: SpotifyPlaylistTrack | null;
  } | null>;
  next: string | null;
}

interface SpotifyPlaylistTrack {
  album: SpotifyAlbum | null;
}

interface SpotifyAlbum {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  release_date: string | null;
  total_tracks: number;
  images: SpotifyImage[];
  external_urls: { spotify?: string };
}

export interface AlbumExtract {
  spotifyAlbumId: string;
  spotifyAlbumUrl: string;
  title: string;
  artist: string;
  year?: number;
  coverUrl?: string;
  trackCount: number;
}

const PLAYLIST_FIELDS_META = "id,name,public,owner(display_name),tracks(total)";
const PLAYLIST_FIELDS_TRACKS =
  "items(track(album(id,name,artists,release_date,total_tracks,images,external_urls))),next";
const MAX_PAGES = 10; // Spotify caps at 100 items/page → 1000-track ceiling per refresh.

export async function fetchPlaylistMeta(
  playlistId: string,
  options: RequestOptions = {},
): Promise<SpotifyPlaylistMeta> {
  const params = new URLSearchParams({ fields: PLAYLIST_FIELDS_META });
  return spotifyGet<SpotifyPlaylistMeta>(`/playlists/${playlistId}?${params.toString()}`, options);
}

/**
 * Walks the paginated tracks endpoint, deduping albums by Spotify id. Returns
 * extracts in the order they were first encountered on the playlist (oldest-
 * added → newest within Spotify's natural order). Tracks without an album
 * (local files, podcast episodes, removed tracks) are silently skipped.
 */
export async function fetchPlaylistAlbumExtracts(
  playlistId: string,
  options: RequestOptions = {},
): Promise<AlbumExtract[]> {
  const params = new URLSearchParams({
    fields: PLAYLIST_FIELDS_TRACKS,
    limit: "100",
  });
  let url: string | null = `/playlists/${playlistId}/tracks?${params.toString()}`;
  const seen = new Set<string>();
  const extracts: AlbumExtract[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    if (!url) break;
    const data: SpotifyPlaylistTrackPage = await spotifyGet<SpotifyPlaylistTrackPage>(url, options);
    for (const item of data.items) {
      const album = item?.track?.album;
      if (!album?.id || seen.has(album.id)) continue;
      seen.add(album.id);
      extracts.push(toExtract(album));
    }
    url = data.next;
  }
  return extracts;
}

function toExtract(album: SpotifyAlbum): AlbumExtract {
  const cover = album.images.find((i) => i.url) ?? null;
  const yearMatch = album.release_date?.match(/^(\d{4})/);
  const artist = album.artists.map((a) => a.name).join(", ");
  return {
    spotifyAlbumId: album.id,
    spotifyAlbumUrl: album.external_urls.spotify ?? `https://open.spotify.com/album/${album.id}`,
    title: album.name,
    artist,
    ...(yearMatch?.[1] ? { year: Number(yearMatch[1]) } : {}),
    ...(cover ? { coverUrl: cover.url } : {}),
    trackCount: album.total_tracks,
  };
}
