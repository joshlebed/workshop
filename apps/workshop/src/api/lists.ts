import type {
  ConfigPreviewRequest,
  ConfigPreviewResponse,
  CreateListRequest,
  DuplicateListRequest,
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
