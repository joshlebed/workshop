import { apiRequest } from "@workshop/api-client/api";
import type {
  AlbumLibraryResponse,
  CreateAlbumListRequest,
  CreateAlbumListResponse,
} from "@workshop/shared";

/** Admin-only: the caller's saved Spotify albums with the album lab's tags. */
export function fetchAlbumLibrary(token: string | null): Promise<AlbumLibraryResponse> {
  return apiRequest<AlbumLibraryResponse>({
    method: "GET",
    path: "/v1/admin/album-library",
    token,
  });
}

/** Admin-only: save picked albums as a Workshop album list (first id on top). */
export function createAlbumList(
  body: CreateAlbumListRequest,
  token: string | null,
): Promise<CreateAlbumListResponse> {
  return apiRequest<CreateAlbumListResponse>({
    method: "POST",
    path: "/v1/admin/album-library/lists",
    body,
    token,
  });
}
