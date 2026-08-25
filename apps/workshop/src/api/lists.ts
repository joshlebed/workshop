import { apiRequest } from "@workshop/api-client/api";
import type {
  ConfigPreviewRequest,
  ConfigPreviewResponse,
  CreateListRequest,
  DuplicateListRequest,
  ListDetailResponse,
  ListListResponse,
  ListPreviewResponse,
  ListResponse,
  ListTagsResponse,
  UpdateListRequest,
} from "@workshop/shared";

export function fetchLists(token: string | null): Promise<ListListResponse> {
  return apiRequest<ListListResponse>({ method: "GET", path: "/v1/lists", token });
}

export function fetchListDetail(id: string, token: string | null): Promise<ListDetailResponse> {
  return apiRequest<ListDetailResponse>({ method: "GET", path: `/v1/lists/${id}`, token });
}

/**
 * Public per-list preview — safe to fetch without a bearer token. Returns
 * the list's name/emoji/owner/counts plus `viewer.isMember`, so the public
 * landing page can pick the right CTA for unauthed visitors, authed
 * non-members, or authed members who arrived here by accident.
 */
export function fetchListPreview(id: string, token: string | null): Promise<ListPreviewResponse> {
  return apiRequest<ListPreviewResponse>({
    method: "GET",
    path: `/v1/lists/${id}/preview`,
    token,
  });
}

/**
 * In-use tags on a list with per-tag item counts — powers the tag editor's
 * suggested-chip picker. (The list-detail chip bar derives the same counts
 * from the already-fetched items, so it doesn't refetch this.)
 */
export function fetchListTags(id: string, token: string | null): Promise<ListTagsResponse> {
  return apiRequest<ListTagsResponse>({ method: "GET", path: `/v1/lists/${id}/tags`, token });
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

export function archiveListEntirely(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/lists/${id}`, token });
}

export function previewListConfig(
  id: string,
  body: ConfigPreviewRequest,
  token: string | null,
): Promise<ConfigPreviewResponse> {
  return apiRequest<ConfigPreviewResponse>({
    method: "POST",
    path: `/v1/lists/${id}/config-preview`,
    body,
    token,
  });
}

export function duplicateList(
  id: string,
  body: DuplicateListRequest,
  token: string | null,
): Promise<ListResponse> {
  return apiRequest<ListResponse>({
    method: "POST",
    path: `/v1/lists/${id}/duplicate`,
    body,
    token,
  });
}

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
