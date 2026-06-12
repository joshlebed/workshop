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
 * `GET /v1/games/discovery` (G2a) — friends' games, each tagged with which
 * friends play it, ranked by friend count. `friendUserId` narrows to one friend
 * (the post-accept picker). `includeOwned` keeps games I already added in the
 * feed (tagged `inMyGames`) so the + sheet can show the full "what my friends
 * play" list; omit it for the addable-only feeds (post-accept picker,
 * friends-but-no-games empty state).
 */
export function fetchGameDiscovery(
  token: string | null,
  options: { friendUserId?: string; includeOwned?: boolean } = {},
): Promise<GameDiscoveryResponse> {
  const params = new URLSearchParams();
  if (options.friendUserId) params.set("friend", options.friendUserId);
  if (options.includeOwned) params.set("includeOwned", "1");
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
