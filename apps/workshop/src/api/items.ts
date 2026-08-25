import { apiRequest } from "@workshop/api-client/api";
import type {
  BulkCreateItemsRequest,
  BulkCreateItemsResponse,
  CreateItemRequest,
  ItemResponse,
  ListItemsResponse,
  MoveItemRequest,
  UpdateItemRequest,
  UpdateItemTagsRequest,
} from "@workshop/shared";

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
 * Replace the item's tag set wholesale (PUT semantics). The server
 * normalizes (trim, lowercase, collapse whitespace) and dedupes, so the
 * returned `item.tags` is the canonical sorted set.
 */
export function updateItemTags(
  itemId: string,
  body: UpdateItemTagsRequest,
  token: string | null,
): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "PUT",
    path: `/v1/items/${itemId}/tags`,
    body,
    token,
  });
}

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

/**
 * Move an item to a new position via the sparse-integer allocator. The
 * server computes the new `position` from `beforeItemId` / `afterItemId`
 * and rebalances the list's ordered section on collision. Both ids null →
 * demote to unordered.
 */
export function moveItem(
  itemId: string,
  body: MoveItemRequest,
  token: string | null,
): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "POST",
    path: `/v1/items/${itemId}/move`,
    body,
    token,
  });
}
