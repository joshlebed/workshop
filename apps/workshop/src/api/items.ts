import type {
  BulkCreateItemsRequest,
  BulkCreateItemsResponse,
  CreateItemRequest,
  ItemResponse,
  ListItemsResponse,
  UpdateItemRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

/**
 * Fetches the unified ordered / unordered / completed split for any list
 * type. Album shelves and other list types share the same shape since the
 * 2026-05 ordering refactor — see `apps/backend/src/routes/v1/items.ts#fetchItemsForList`.
 */
export function fetchItems(listId: string, token: string | null): Promise<ListItemsResponse> {
  return apiRequest<ListItemsResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/items`,
    token,
  });
}

export function fetchItem(itemId: string, token: string | null): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({ method: "GET", path: `/v1/items/${itemId}`, token });
}

export function createItem(
  listId: string,
  body: CreateItemRequest,
  token: string | null,
): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/items`,
    body,
    token,
  });
}

/**
 * Bulk variant — server caps at 50 entries per call. Caller chunks if more
 * are pasted. Each entry has the same shape as `CreateItemRequest`, minus
 * the per-list-type metadata blob (bulk path is meant for raw-title pastes;
 * enrichment via TMDB / Google Books happens as a follow-up).
 */
export function createItemsBulk(
  listId: string,
  body: BulkCreateItemsRequest,
  token: string | null,
): Promise<BulkCreateItemsResponse> {
  return apiRequest<BulkCreateItemsResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/items/bulk`,
    body,
    token,
  });
}

export function updateItem(
  itemId: string,
  body: UpdateItemRequest,
  token: string | null,
): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "PATCH",
    path: `/v1/items/${itemId}`,
    body,
    token,
  });
}

/**
 * Archives (soft-deletes) the item. The server sets `items.archived_at` and
 * the row immediately drops out of every read — the items split, item
 * detail, and item-scoped activity-feed events. Upvotes and game scores
 * stay in the DB so a future unarchive surface can restore the item
 * intact. For album_shelf items the partial unique index on
 * (list_id, spotifyAlbumId) still includes archived rows, so a refresh
 * won't resurface an album the user explicitly archived.
 */
export function archiveItem(itemId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/items/${itemId}`, token });
}

export function completeItem(itemId: string, token: string | null): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "POST",
    path: `/v1/items/${itemId}/complete`,
    token,
  });
}

export function uncompleteItem(itemId: string, token: string | null): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "POST",
    path: `/v1/items/${itemId}/uncomplete`,
    token,
  });
}
