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

export function deleteList(id: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/lists/${id}`, token });
}
