// Games-surface API (spec §3.7, G1a/G2a) — the new flag-gated `/v1/games`
// routes. Entirely separate from the Lists leaderboard wrappers in
// `scores.ts`; nothing here touches `/v1/items` or `/v1/lists`.

import { apiRequest } from "@workshop/api-client/api";
import type { GameScoreSource } from "@workshop/shared/constants";
import type {
  AddGameResponse,
  GameDiscoveryResponse,
  GameLeaderboardResponse,
  GameScoreDirection,
  GameShareLinkPreview,
  GameShareLinkResponse,
  GamesResponse,
  SetGameScoreSpecResponse,
  SetScoreReactionResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";
import type { ScoreSpec } from "@workshop/shared/scoreParsing";
import type { SummarySpec } from "@workshop/shared/summarySpec";
import { z } from "zod";

const gameShareLinkResponseSchema = z.object({ token: z.string(), url: z.string() });

const gameShareLinkPreviewSchema = z.object({
  user: z.object({ userId: z.string(), displayName: z.string().nullable() }),
  viewer: z.object({ isSelf: z.boolean(), isFriend: z.boolean() }).optional(),
});

/**
 * `POST /v1/game-share` — mint/reuse my per-day "play with me" link (`/g/:token`),
 * the call-to-action appended to the Games-tab copy-scores recap. Idempotent
 * per day on the server, so re-copying returns the same link.
 */
export async function createGameShareLink(token: string | null): Promise<GameShareLinkResponse> {
  const raw = await apiRequest<unknown>({ method: "POST", path: "/v1/game-share", token });
  return gameShareLinkResponseSchema.parse(raw);
}

/**
 * `GET /v1/game-share/:token` — resolve a play link to its sharer + (for a
 * signed-in request) the viewer's relationship, which drives the `/g/:token`
 * landing's routing. Zod-validated: the response steers navigation, so a
 * malformed body should surface as a clean error, not a crash.
 */
export async function fetchGameShareLink(
  linkToken: string,
  token: string | null,
): Promise<GameShareLinkPreview> {
  const raw = await apiRequest<unknown>({
    method: "GET",
    path: `/v1/game-share/${encodeURIComponent(linkToken)}`,
    token,
  });
  return gameShareLinkPreviewSchema.parse(raw);
}

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
  // `source` is write provenance ("share_extension" | "paste") — observability
  // for share-panel adoption; older clients omit it.
  body: { periodKey: string; scoreRaw: string; source?: GameScoreSource },
  token: string | null,
): Promise<UpsertGameScoreResponse> {
  return apiRequest<UpsertGameScoreResponse>({
    method: "PUT",
    path: `/v1/games/${gameId}/scores`,
    body,
    token,
  });
}

/** `DELETE /v1/games/:id/scores/:periodKey` — clear your score for that day. */
export function clearGameScore(
  gameId: string,
  periodKey: string,
  token: string | null,
): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>({
    method: "DELETE",
    path: `/v1/games/${gameId}/scores/${periodKey}`,
    token,
  });
}

/**
 * `PUT /v1/games/:id/score-spec` — teach a non-registry game its parser (the
 * tap-the-score flow) and, optionally, its recap formatter (`summarySpec`,
 * built from the lines kept in the recap preview). The server re-runs `spec`
 * against `exampleRaw` and rejects the write unless it reproduces
 * `expectedValue`; a `summarySpec` must render the example to something.
 */
export function setGameScoreSpec(
  gameId: string,
  body: {
    spec: ScoreSpec;
    exampleRaw: string;
    expectedValue: number;
    scoreDirection: GameScoreDirection;
    summarySpec: SummarySpec | null;
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
