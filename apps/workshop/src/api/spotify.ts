import type {
  SaveAlbumRequest,
  SavedAlbumListResponse,
  SavedAlbumResponse,
  SpotifyAlbumSearchResponse,
  SpotifyAuthorizeResponse,
  SpotifyConnectionStatus,
  SpotifyNowPlaying,
  SpotifyPlaylistListResponse,
  SpotifyPlaylistTracksResponse,
  SpotifyRecentListensResponse,
  SyncPlaylistAlbumsResponse,
  UpdateSavedAlbumRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function fetchSpotifyStatus(token: string | null): Promise<SpotifyConnectionStatus> {
  return apiRequest<SpotifyConnectionStatus>({
    method: "GET",
    path: "/v1/spotify/auth/status",
    token,
  });
}

export function startSpotifyAuthorize(
  token: string | null,
  appRedirect?: string,
): Promise<SpotifyAuthorizeResponse> {
  const qs = appRedirect ? `?appRedirect=${encodeURIComponent(appRedirect)}` : "";
  return apiRequest<SpotifyAuthorizeResponse>({
    method: "POST",
    path: `/v1/spotify/auth/authorize${qs}`,
    token,
  });
}

export function disconnectSpotify(token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: "/v1/spotify/auth",
    token,
  });
}

export function fetchSavedAlbums(token: string | null): Promise<SavedAlbumListResponse> {
  return apiRequest<SavedAlbumListResponse>({
    method: "GET",
    path: "/v1/spotify/albums",
    token,
  });
}

export function searchSpotifyAlbums(
  query: string,
  token: string | null,
): Promise<SpotifyAlbumSearchResponse> {
  const qs = `?q=${encodeURIComponent(query)}`;
  return apiRequest<SpotifyAlbumSearchResponse>({
    method: "GET",
    path: `/v1/spotify/albums/search${qs}`,
    token,
  });
}

export function saveAlbum(
  body: SaveAlbumRequest,
  token: string | null,
): Promise<SavedAlbumResponse> {
  return apiRequest<SavedAlbumResponse>({
    method: "POST",
    path: "/v1/spotify/albums",
    body,
    token,
  });
}

export function updateSavedAlbum(
  spotifyAlbumId: string,
  body: UpdateSavedAlbumRequest,
  token: string | null,
): Promise<SavedAlbumResponse> {
  return apiRequest<SavedAlbumResponse>({
    method: "PATCH",
    path: `/v1/spotify/albums/${encodeURIComponent(spotifyAlbumId)}`,
    body,
    token,
  });
}

export function unsaveAlbum(spotifyAlbumId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/spotify/albums/${encodeURIComponent(spotifyAlbumId)}`,
    token,
  });
}

export function fetchNowPlaying(token: string | null): Promise<SpotifyNowPlaying> {
  return apiRequest<SpotifyNowPlaying>({
    method: "GET",
    path: "/v1/spotify/now-playing",
    token,
  });
}

export function fetchRecentListens(token: string | null): Promise<SpotifyRecentListensResponse> {
  return apiRequest<SpotifyRecentListensResponse>({
    method: "GET",
    path: "/v1/spotify/recent",
    token,
  });
}

export function fetchSpotifyPlaylists(token: string | null): Promise<SpotifyPlaylistListResponse> {
  return apiRequest<SpotifyPlaylistListResponse>({
    method: "GET",
    path: "/v1/spotify/playlists",
    token,
  });
}

export function fetchSpotifyPlaylistTracks(
  playlistId: string,
  token: string | null,
): Promise<SpotifyPlaylistTracksResponse> {
  return apiRequest<SpotifyPlaylistTracksResponse>({
    method: "GET",
    path: `/v1/spotify/playlists/${encodeURIComponent(playlistId)}/tracks`,
    token,
  });
}

export function syncPlaylistAlbums(
  playlistId: string,
  token: string | null,
): Promise<SyncPlaylistAlbumsResponse> {
  return apiRequest<SyncPlaylistAlbumsResponse>({
    method: "POST",
    path: `/v1/spotify/playlists/${encodeURIComponent(playlistId)}/sync-albums`,
    token,
  });
}
