// Games-surface API (spec §3.7, G1a/G2a) — the new flag-gated `/v1/games`
// routes. Entirely separate from the Lists leaderboard wrappers in
// `scores.ts`; nothing here touches `/v1/items` or `/v1/lists`.

import type {
  AddGameResponse,
  GameDiscoveryResponse,
  GameLeaderboardResponse,
  GamesResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import { apiRequest } from "../lib/api";

export function fetchMyGames(periodKey: string, token: string | null): Promise<GamesResponse> {
  const params = new URLSearchParams({ period: periodKey });
  return apiRequest<GamesResponse>({
    method: "GET",
    path: `/v1/games?${params.toString()}`,
    token,
  });
}

export function addGame(url: string, token: string | null): Promise<AddGameResponse> {
  return apiRequest<AddGameResponse>({
    method: "POST",
    path: "/v1/games",
    body: { url },
    token,
  });
}

export function removeGame(gameId: string, token: string | null): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/games/${gameId}`,
    token,
  });
}

export function moveGame(
  gameId: string,
  body: { beforeGameId: string | null; afterGameId: string | null },
  token: string | null,
): Promise<{ position: number | null; rebalanced: boolean }> {
  return apiRequest<{ position: number | null; rebalanced: boolean }>({
    method: "POST",
    path: `/v1/games/${gameId}/move`,
    body,
    token,
  });
}

export function upsertGameScore(
  gameId: string,
  body: { periodKey: string; scoreRaw: string },
  token: string | null,
): Promise<UpsertGameScoreResponse> {
  return apiRequest<UpsertGameScoreResponse>({
    method: "PUT",
    path: `/v1/games/${gameId}/scores`,
    body,
    token,
  });
}

/**
 * `GET /v1/games/discovery` (G2a) — friends' games I haven't added yet, each
 * tagged with which friends play it. `friendUserId` narrows to one friend
 * (the post-accept picker); omit it for the all-friends feed that powers the
 * + sheet suggestions and the friends-but-no-games empty state.
 */
export function fetchGameDiscovery(
  token: string | null,
  friendUserId?: string,
): Promise<GameDiscoveryResponse> {
  const params = new URLSearchParams();
  if (friendUserId) params.set("friend", friendUserId);
  const qs = params.toString();
  return apiRequest<GameDiscoveryResponse>({
    method: "GET",
    path: `/v1/games/discovery${qs ? `?${qs}` : ""}`,
    token,
  });
}

export function fetchGameLeaderboard(
  gameId: string,
  periodKey: string,
  token: string | null,
): Promise<GameLeaderboardResponse> {
  const params = new URLSearchParams({ period: periodKey });
  return apiRequest<GameLeaderboardResponse>({
    method: "GET",
    path: `/v1/games/${gameId}/leaderboard?${params.toString()}`,
    token,
  });
}
