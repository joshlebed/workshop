// Games-surface API (spec §3.7, G1a/G2a) — the new flag-gated `/v1/games`
// routes. Entirely separate from the Lists leaderboard wrappers in
// `scores.ts`; nothing here touches `/v1/items` or `/v1/lists`.

import type {
  AddGameResponse,
  GameDiscoveryResponse,
  GameLeaderboardResponse,
  GameScoreDirection,
  GamesResponse,
  SetGameScoreSpecResponse,
  SetScoreReactionResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import type { ScoreSpec } from "@workshop/shared/scoreParsing";
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
 * `PUT /v1/games/:id/score-spec` — teach a non-registry game its parser (the
 * tap-the-score flow). The server re-runs `spec` against `exampleRaw` and
 * rejects the write unless it reproduces `expectedValue`.
 */
export function setGameScoreSpec(
  gameId: string,
  body: {
    spec: ScoreSpec;
    exampleRaw: string;
    expectedValue: number;
    scoreDirection: GameScoreDirection;
  },
  token: string | null,
): Promise<SetGameScoreSpecResponse> {
  return apiRequest<SetGameScoreSpecResponse>({
    method: "PUT",
    path: `/v1/games/${gameId}/score-spec`,
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

/**
 * `PUT /v1/games/:id/reactions/:periodKey/:scoreUserId` — set or replace the
 * viewer's emoji reaction on a friend's score (tapback: one per reactor).
 * Returns the affected score's full reaction summary.
 */
export function setScoreReaction(
  gameId: string,
  periodKey: string,
  scoreUserId: string,
  emoji: string,
  token: string | null,
): Promise<SetScoreReactionResponse> {
  return apiRequest<SetScoreReactionResponse>({
    method: "PUT",
    path: `/v1/games/${gameId}/reactions/${periodKey}/${scoreUserId}`,
    body: { emoji },
    token,
  });
}

/** `DELETE /v1/games/:id/reactions/:periodKey/:scoreUserId` — clear the viewer's reaction. */
export function removeScoreReaction(
  gameId: string,
  periodKey: string,
  scoreUserId: string,
  token: string | null,
): Promise<SetScoreReactionResponse> {
  return apiRequest<SetScoreReactionResponse>({
    method: "DELETE",
    path: `/v1/games/${gameId}/reactions/${periodKey}/${scoreUserId}`,
    token,
  });
}
