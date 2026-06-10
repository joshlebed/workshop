import type { ItemResponse, LetterboxdStatusResponse, SuggestFilmRequest } from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function fetchLetterboxdStatus(
  listId: string,
  token: string | null,
): Promise<LetterboxdStatusResponse> {
  return apiRequest<LetterboxdStatusResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/letterboxd`,
    token,
  });
}

export function suggestFilm(
  listId: string,
  body: SuggestFilmRequest,
  token: string | null,
): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "POST",
    path: `/v1/lists/${listId}/letterboxd/suggest`,
    body,
    token,
  });
}

export function acceptItem(itemId: string, token: string | null): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "POST",
    path: `/v1/items/${itemId}/accept`,
    token,
  });
}

export function unacceptItem(itemId: string, token: string | null): Promise<ItemResponse> {
  return apiRequest<ItemResponse>({
    method: "DELETE",
    path: `/v1/items/${itemId}/accept`,
    token,
  });
}
