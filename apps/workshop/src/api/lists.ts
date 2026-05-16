import type {
  CreateListRequest,
  ListDetailResponse,
  ListListResponse,
  ListResponse,
  UpdateListRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function fetchLists(token: string | null): Promise<ListListResponse> {
  return apiRequest<ListListResponse>({ method: "GET", path: "/v1/lists", token });
}

export function fetchListDetail(id: string, token: string | null): Promise<ListDetailResponse> {
  return apiRequest<ListDetailResponse>({ method: "GET", path: `/v1/lists/${id}`, token });
}

export function createList(body: CreateListRequest, token: string | null): Promise<ListResponse> {
  return apiRequest<ListResponse>({ method: "POST", path: "/v1/lists", body, token });
}

export function updateList(
  id: string,
  body: UpdateListRequest,
  token: string | null,
): Promise<ListResponse> {
  return apiRequest<ListResponse>({ method: "PATCH", path: `/v1/lists/${id}`, body, token });
}

/**
 * Archives (soft-deletes) the list. Owner-only. The server sets
 * `lists.archived_at` and the row immediately disappears from every read
 * path — list-detail returns 404, the home feed omits it, items become
 * unreachable. The underlying rows (items, members, invites, activity
 * events) stay in place so a future unarchive surface can restore them.
 *
 * Distinct from the per-(list, viewer) `archiveList` toggle in this file,
 * which only hides a list from the requester's own home feed.
 */
export function archiveListEntirely(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/lists/${id}`, token });
}

// Per-(list, viewer) view-state toggles. All four return `{ ok: true }` and
// expect the caller to invalidate the lists query so the resulting
// `unreadCount` / `pinnedAt` / `archivedAt` / `mutedAt` show up.

export function markListRead(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "POST", path: `/v1/lists/${id}/read`, token });
}

export function pinList(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "POST", path: `/v1/lists/${id}/pin`, token });
}

export function unpinList(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/lists/${id}/pin`, token });
}

export function archiveList(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "POST", path: `/v1/lists/${id}/archive`, token });
}

export function unarchiveList(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/lists/${id}/archive`, token });
}

export function muteList(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "POST", path: `/v1/lists/${id}/mute`, token });
}

export function unmuteList(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/lists/${id}/mute`, token });
}
