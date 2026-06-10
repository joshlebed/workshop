import type {
  CreateSavedViewRequest,
  SavedViewResponse,
  SavedViewsResponse,
  UpdateSavedViewRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

/**
 * Saved views (spec §2.3) — named, shared tag filters on a list. CRUD against
 * `/v1/lists/:id/views`. Any member creates; the creator or list owner
 * edits/removes (the backend enforces it, returning 403 otherwise).
 */

export function fetchSavedViews(listId: string, token: string | null): Promise<SavedViewsResponse> {
  return apiRequest<SavedViewsResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/views`,
    token,
  });
}

export function createSavedView(
  listId: string,
  body: CreateSavedViewRequest,
  token: string | null,
): Promise<SavedViewResponse> {
  return apiRequest<SavedViewResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/views`,
    body,
    token,
  });
}

export function updateSavedView(
  listId: string,
  viewId: string,
  body: UpdateSavedViewRequest,
  token: string | null,
): Promise<SavedViewResponse> {
  return apiRequest<SavedViewResponse>({
    method: "PATCH",
    path: `/v1/lists/${listId}/views/${viewId}`,
    body,
    token,
  });
}

export function deleteSavedView(
  listId: string,
  viewId: string,
  token: string | null,
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/lists/${listId}/views/${viewId}`,
    token,
  });
}
