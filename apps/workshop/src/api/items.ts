import type {
  CreateItemRequest,
  ItemListResponse,
  ItemResponse,
  UpdateItemRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

export interface ItemListFilter {
  /** When set, the server returns only completed (true) or only active (false) items. */
  completed?: boolean;
}

export function fetchItems(
  listId: string,
  filter: ItemListFilter,
  token: string | null,
): Promise<ItemListResponse> {
  const search =
    filter.completed === undefined ? "" : `?completed=${filter.completed ? "true" : "false"}`;
  return apiRequest<ItemListResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/items${search}`,
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

export function deleteItem(itemId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({ method: "DELETE", path: `/v1/items/${itemId}`, token });
}

export function upvoteItem(itemId: string, token: string | null): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "POST",
    path: `/v1/items/${itemId}/upvote`,
    token,
  });
}

export function removeUpvote(itemId: string, token: string | null): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "DELETE",
    path: `/v1/items/${itemId}/upvote`,
    token,
  });
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
