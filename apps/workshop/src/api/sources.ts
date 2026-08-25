import { apiRequest } from "@workshop/api-client/api";
import type {
  CreateListSourceRequest,
  ListSource,
  ListSourceResponse,
  ListSourcesResponse,
  SourcePreviewRequest,
  SourcePreviewResponse,
  SyncSourceResponse,
} from "@workshop/shared";

export function fetchSources(listId: string, token: string | null): Promise<ListSourcesResponse> {
  return apiRequest<ListSourcesResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/sources`,
    token,
  });
}

export function previewSource(
  body: SourcePreviewRequest,
  token: string | null,
): Promise<SourcePreviewResponse> {
  return apiRequest<SourcePreviewResponse>({
    method: "POST",
    path: `/v1/sources/preview`,
    body,
    token,
  });
}

export function createSource(
  listId: string,
  body: CreateListSourceRequest,
  token: string | null,
): Promise<ListSourceResponse> {
  return apiRequest<ListSourceResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/sources`,
    body,
    token,
  });
}

export function deleteSource(
  listId: string,
  sourceId: string,
  token: string | null,
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/lists/${listId}/sources/${sourceId}`,
    token,
  });
}

export function syncSource(
  listId: string,
  sourceId: string,
  token: string | null,
): Promise<SyncSourceResponse> {
  return apiRequest<SyncSourceResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/sources/${sourceId}/sync`,
    token,
  });
}

export type { ListSource };
