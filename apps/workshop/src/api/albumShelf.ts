import type {
  AlbumShelfItemsResponse,
  AlbumShelfPreviewResponse,
  AlbumShelfRefreshResponse,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

/**
 * Preview a Spotify playlist URL via the backend before the user finishes
 * the create-shelf flow. Resolves with playlist metadata on success or
 * throws an `ApiError` with `details.code` set to one of
 * `INVALID_PLAYLIST_URL`, `PLAYLIST_NOT_AVAILABLE`, `SPOTIFY_UNAVAILABLE`.
 */
export function previewSpotifyPlaylist(
  url: string,
  token: string | null,
): Promise<AlbumShelfPreviewResponse> {
  return apiRequest<AlbumShelfPreviewResponse>({
    method: "POST",
    path: "/v1/album-shelf/preview",
    body: { url },
    token,
  });
}

/** Validate a Spotify playlist URL against the backend. Wraps `POST /v1/lists` */
// is implicit — there's no separate validate endpoint; the create call performs
// validation as part of the flow.

/**
 * Refresh an album_shelf — re-pulls its source playlist from Spotify and
 * inserts any new albums as detected items. Pure-additive on the server.
 */
export function refreshAlbumShelf(
  listId: string,
  token: string | null,
): Promise<AlbumShelfRefreshResponse> {
  return apiRequest<AlbumShelfRefreshResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/refresh`,
    token,
  });
}

/**
 * Fetch the split (ordered + detected) view of an album_shelf's items. The
 * backend returns this shape only for album_shelf lists; other types return
 * the standard `{ items }` shape.
 */
export function fetchAlbumShelfItems(
  listId: string,
  token: string | null,
): Promise<AlbumShelfItemsResponse> {
  return apiRequest<AlbumShelfItemsResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/items`,
    token,
  });
}
