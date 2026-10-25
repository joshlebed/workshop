// Writes a just-posted score straight into the cached `GET /v1/games` list,
// so the home card shows it the moment the post lands — before, not after,
// the list is refetched. The refetch still runs (in the background) and
// replaces this with the server's ranking.

import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GameScore, GameStandingsEntry, GamesResponse } from "@workshop/shared/games";

/** The signed-in user, as the row will name them. */
export interface PostedScoreViewer {
  id: string;
  displayName: string | null;
}

/**
 * The list with the viewer's row for `score.gameId` replaced by (or, on a
 * first post of the day, extended with) the posted score. Untouched when the
 * game is not in the list — a share to a game posting adds — or when there
 * is no list. Keeps the row's rank and reactions: the server re-ranks on the
 * refetch that follows.
 */
export function applyPostedScore(
  data: GamesResponse | undefined,
  score: GameScore,
  viewer: PostedScoreViewer,
): GamesResponse | undefined {
  if (!data || data.periodKey !== score.periodKey) return data;
  if (!data.games.some((g) => g.gameId === score.gameId)) return data;
  return {
    ...data,
    games: data.games.map((mg) => {
      if (mg.gameId !== score.gameId) return mg;
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
  score: GameScore,
  viewer: PostedScoreViewer | null,
): void {
  if (!viewer) return;
  queryClient.setQueryData<GamesResponse>(queryKeys.games.mine(score.periodKey), (data) =>
    applyPostedScore(data, score, viewer),
  );
}
