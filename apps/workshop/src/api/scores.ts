import type {
  ItemScoreResponse,
  LeaderboardResponse,
  ListScoresResponse,
  UpsertItemScoreRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function fetchItemScores(
  itemId: string,
  periodKey: string,
  token: string | null,
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams({ periodKey });
  return apiRequest<LeaderboardResponse>({
    method: "GET",
    path: `/v1/items/${itemId}/scores?${params.toString()}`,
    token,
  });
}

export function upsertItemScore(
  itemId: string,
  body: UpsertItemScoreRequest,
  token: string | null,
): Promise<ItemScoreResponse> {
  return apiRequest<ItemScoreResponse>({
    method: "PUT",
    path: `/v1/items/${itemId}/scores`,
    body,
    token,
  });
}

export function deleteItemScore(
  itemId: string,
  periodKey: string,
  token: string | null,
): Promise<{ ok: true }> {
  const params = new URLSearchParams({ periodKey });
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/items/${itemId}/scores?${params.toString()}`,
    token,
  });
}

export function fetchListScores(
  listId: string,
  periodKey: string,
  token: string | null,
): Promise<ListScoresResponse> {
  const params = new URLSearchParams({ periodKey });
  return apiRequest<ListScoresResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/scores?${params.toString()}`,
    token,
  });
}
