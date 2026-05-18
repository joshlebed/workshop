import type {
  BulkCreateItemsRequest,
  BulkCreateItemsResponse,
  CreateItemRequest,
  ItemResponse,
  ItemUpvoteResponse,
  ListItemsResponse,
  MoveItemRequest,
  UpdateItemRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

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

export function upvoteItem(itemId: string, token: string | null): Promise<ItemUpvoteResponse> {
  return apiRequest<ItemUpvoteResponse>({
    method: "POST",
    path: `/v1/items/${itemId}/upvote`,
    token,
  });
}

export function removeUpvote(itemId: string, token: string | null): Promise<ItemUpvoteResponse> {
  return apiRequest<ItemUpvoteResponse>({
    method: "DELETE",
    path: `/v1/items/${itemId}/upvote`,
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
