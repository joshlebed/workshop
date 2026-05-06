import type { AlbumShelfPreviewResponse, AlbumShelfRefreshResponse } from "@workshop/shared";
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

/**
 * Refresh an album_shelf — re-pulls its source playlist from Spotify and
 * inserts any new albums as detected items. Pure-additive on the server.
 * Returns the same `{ ordered, unordered, completed }` split every list
 * type uses, plus refresh metadata (`refreshedAt`, `addedCount`).
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
