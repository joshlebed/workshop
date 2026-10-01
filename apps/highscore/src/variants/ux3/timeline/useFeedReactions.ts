// Reactions across the whole day feed.
//
// The per-screen `useScoreReactions` binds one period key and one query key,
// which was right when a screen showed exactly one day. The timeline shows many
// days at once, so this variant carries the day on the *call* instead: every
// feed day is a `GamesResponse` under `queryKeys.games.mine(dateKey)`, so one
// hook (and one picker sheet) serves today, yesterday and every expanded
// section. Optimistic apply / server reconcile / rollback are unchanged.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GamesResponse, ScoreReactionSummary } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useCallback, useState } from "react";
import { removeScoreReaction, setScoreReaction } from "../games/api/games";
import { applyViewerReaction, type ReactionChange } from "../games/lib/scoreReactions";
import { useToast } from "../theme";

export interface FeedReactionTarget {
  dateKey: string;
  gameId: string;
  scoreUserId: string;
  name: string | null;
}

interface Vars {
  dateKey: string;
  gameId: string;
  scoreUserId: string;
  change: ReactionChange;
}

function readReactions(
  data: GamesResponse,
  gameId: string,
  scoreUserId: string,
): ScoreReactionSummary[] {
  return (
    data.games
      .find((g) => g.gameId === gameId)
      ?.standings.entries.find((e) => e.userId === scoreUserId)?.reactions ?? []
  );
}

function writeReactions(
  data: GamesResponse,
  gameId: string,
  scoreUserId: string,
  next: ScoreReactionSummary[],
): GamesResponse {
  return {
    ...data,
    games: data.games.map((g) =>
      g.gameId === gameId
        ? {
            ...g,
            standings: {
              ...g.standings,
              entries: g.standings.entries.map((e) =>
                e.userId === scoreUserId ? { ...e, reactions: next } : e,
              ),
            },
          }
        : g,
    ),
  };
}

export function useFeedReactions({
  token,
  viewer,
}: {
  token: string | null;
  viewer: { userId: string; displayName: string | null } | null;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [target, setTarget] = useState<FeedReactionTarget | null>(null);

  const mutation = useMutation<
    { reactions: ScoreReactionSummary[] },
    Error,
    Vars,
    { prev: GamesResponse | undefined; queryKey: readonly unknown[] }
  >({
    mutationFn: ({ dateKey, gameId, scoreUserId, change }) =>
      change.type === "set"
        ? setScoreReaction(gameId, dateKey, scoreUserId, change.emoji, token)
        : removeScoreReaction(gameId, dateKey, scoreUserId, token),
    onMutate: async ({ dateKey, gameId, scoreUserId, change }) => {
      const queryKey = queryKeys.games.mine(dateKey);
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<GamesResponse>(queryKey);
      if (prev && viewer) {
        const next = applyViewerReaction(readReactions(prev, gameId, scoreUserId), viewer, change);
        queryClient.setQueryData<GamesResponse>(
          queryKey,
          writeReactions(prev, gameId, scoreUserId, next),
        );
      }
      return { prev, queryKey };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(ctx.queryKey, ctx.prev);
      showToast({ message: errorMessage(e, "Couldn't react"), tone: "danger" });
    },
    onSuccess: (data, { dateKey, gameId, scoreUserId }) => {
      haptics.light();
      const queryKey = queryKeys.games.mine(dateKey);
      const cur = queryClient.getQueryData<GamesResponse>(queryKey);
      if (cur) {
        queryClient.setQueryData<GamesResponse>(
          queryKey,
          writeReactions(cur, gameId, scoreUserId, data.reactions),
        );
      }
    },
    onSettled: (_data, _err, { dateKey }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(dateKey) });
    },
  });

  const { mutate } = mutation;

  const react = useCallback(
    (
      dateKey: string,
      gameId: string,
      scoreUserId: string,
      emoji: string,
      currentlyReacted: boolean,
    ) => {
      mutate({
        dateKey,
        gameId,
        scoreUserId,
        change: currentlyReacted ? { type: "remove" } : { type: "set", emoji },
      });
    },
    [mutate],
  );

  const openPicker = useCallback((next: FeedReactionTarget) => setTarget(next), []);
  const closePicker = useCallback(() => setTarget(null), []);

  const data = target
    ? queryClient.getQueryData<GamesResponse>(queryKeys.games.mine(target.dateKey))
    : undefined;
  const currentEmoji =
    target && data
      ? (readReactions(data, target.gameId, target.scoreUserId).find((r) => r.viewerReacted)
          ?.emoji ?? null)
      : null;

  const pick = useCallback(
    (emoji: string) => {
      if (!target) return;
      mutate({
        dateKey: target.dateKey,
        gameId: target.gameId,
        scoreUserId: target.scoreUserId,
        change: { type: "set", emoji },
      });
      setTarget(null);
    },
    [mutate, target],
  );
  const removeReaction = useCallback(() => {
    if (!target) return;
    mutate({
      dateKey: target.dateKey,
      gameId: target.gameId,
      scoreUserId: target.scoreUserId,
      change: { type: "remove" },
    });
    setTarget(null);
  }, [mutate, target]);

  return { target, react, openPicker, closePicker, currentEmoji, pick, removeReaction };
}
