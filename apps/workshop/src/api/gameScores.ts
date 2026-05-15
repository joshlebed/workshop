import type {
  GameLeaderboardResponse,
  GameScoreResponse,
  ListGameScoresResponse,
  UpsertGameScoreRequest,
} from "@workshop/shared";
import { apiRequest } from "../lib/api";

export function fetchItemScores(
  itemId: string,
  date: string,
  token: string | null,
): Promise<GameLeaderboardResponse> {
  const params = new URLSearchParams({ date });
  return apiRequest<GameLeaderboardResponse>({
    method: "GET",
    path: `/v1/items/${itemId}/scores?${params.toString()}`,
    token,
  });
}

export function upsertItemScore(
  itemId: string,
  body: UpsertGameScoreRequest,
  token: string | null,
): Promise<GameScoreResponse> {
  return apiRequest<GameScoreResponse>({
    method: "PUT",
    path: `/v1/items/${itemId}/scores`,
    body,
    token,
  });
}

export function deleteItemScore(
  itemId: string,
  date: string,
  token: string | null,
): Promise<{ ok: true }> {
  const params = new URLSearchParams({ date });
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/items/${itemId}/scores?${params.toString()}`,
    token,
  });
}

export function fetchListGameScores(
  listId: string,
  date: string,
  token: string | null,
): Promise<ListGameScoresResponse> {
  const params = new URLSearchParams({ date });
  return apiRequest<ListGameScoresResponse>({
    method: "GET",
    path: `/v1/lists/${listId}/game-scores?${params.toString()}`,
    token,
  });
}
