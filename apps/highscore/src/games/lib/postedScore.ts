// Writes a just-posted score straight into the cached `GET /v1/games` list,
// so the home card shows it the moment the post lands — before, not after,
// the list is refetched. A post response that carries the game's `standings`
// (the server's own ranking, with the new row in place) replaces the card's
// block outright; an older server's response, with only the score, patches
// the viewer's row in and leaves ranking to the refetch that follows.

import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type {
  GameScore,
  GameStandings,
  GameStandingsEntry,
  GamesResponse,
  UpsertGameScoreResponse,
} from "@workshop/shared/games";

/** The signed-in user, as the row will name them. */
export interface PostedScoreViewer {
  id: string;
  displayName: string | null;
}

/**
 * The list with the game's block for `score.gameId` brought up to date:
 * the server's `standings` when the post returned them, else the viewer's
 * row replaced by (or, on a first post of the day, extended with) the posted
 * score, keeping its rank and reactions for the refetch to settle. Untouched
 * when the game is not in the list — a share to a game posting adds — or
 * when there is no list.
 */
export function applyPostedScore(
  data: GamesResponse | undefined,
  score: GameScore,
  viewer: PostedScoreViewer,
  standings?: GameStandings,
): GamesResponse | undefined {
  if (!data || data.periodKey !== score.periodKey) return data;
  if (!data.games.some((g) => g.gameId === score.gameId)) return data;
  return {
    ...data,
    games: data.games.map((mg) => {
      if (mg.gameId !== score.gameId) return mg;
      if (standings && standings.periodKey === score.periodKey) return { ...mg, standings };
      const previous = mg.standings.entries.find((e) => e.userId === viewer.id);
      const entry: GameStandingsEntry = {
        userId: viewer.id,
        displayName: viewer.displayName,
        rank: previous?.rank ?? null,
        reactions: previous?.reactions ?? [],
        scoreRaw: score.scoreRaw,
        scoreValue: score.scoreValue,
        updatedAt: score.updatedAt,
        ...("parseStatus" in score ? { parseStatus: score.parseStatus } : {}),
        ...("scoreSummary" in score ? { scoreSummary: score.scoreSummary } : {}),
        ...("scoreSource" in score ? { scoreSource: score.scoreSource } : {}),
        ...("adjusted" in score ? { adjusted: score.adjusted } : {}),
      };
      const entries = previous
        ? mg.standings.entries.map((e) => (e.userId === viewer.id ? entry : e))
        : [...mg.standings.entries, entry];
      return { ...mg, standings: { ...mg.standings, entries, viewerHasPlayed: true } };
    }),
  };
}

/** `applyPostedScore` over the cached list for the score's day. No-op without a viewer. */
export function writePostedScore(
  queryClient: QueryClient,
  posted: UpsertGameScoreResponse,
  viewer: PostedScoreViewer | null,
): void {
  if (!viewer) return;
  queryClient.setQueryData<GamesResponse>(queryKeys.games.mine(posted.score.periodKey), (data) =>
    applyPostedScore(data, posted.score, viewer, posted.standings),
  );
}
