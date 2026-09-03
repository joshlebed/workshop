// Score-reaction state + mutations (G2c), shared by the Games home cards and
// the per-game board. The two surfaces hold standings in differently-shaped
// react-query caches, so the caller supplies `readReactions` / `writeReactions`
// to locate one score's reactions inside its own cache shape; everything else
// (optimistic apply, server-echo reconcile, rollback, picker state) lives here.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import type { ScoreReactionSummary, SetScoreReactionResponse } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useCallback, useState } from "react";
import { useToast } from "../../theme";
import { removeScoreReaction, setScoreReaction } from "../api/games";
import { applyViewerReaction, type ReactionChange } from "../lib/scoreReactions";

export interface ReactionTarget {
  gameId: string;
  scoreUserId: string;
  name: string | null;
}

interface UseScoreReactionsOptions<TData> {
  /** Puzzle day the displayed standings belong to — reactions post to this day. */
  periodKey: string;
  token: string | null;
  viewer: { userId: string; displayName: string | null } | null;
  /** The react-query key holding the displayed standings. */
  queryKey: readonly unknown[];
  readReactions: (data: TData, gameId: string, scoreUserId: string) => ScoreReactionSummary[];
  writeReactions: (
    data: TData,
    gameId: string,
    scoreUserId: string,
    next: ScoreReactionSummary[],
  ) => TData;
}

export function useScoreReactions<TData>({
  periodKey,
  token,
  viewer,
  queryKey,
  readReactions,
  writeReactions,
}: UseScoreReactionsOptions<TData>) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [target, setTarget] = useState<ReactionTarget | null>(null);

  const mutation = useMutation<
    SetScoreReactionResponse,
    Error,
    { gameId: string; scoreUserId: string; change: ReactionChange },
    { prev: TData | undefined }
  >({
    mutationFn: ({ gameId, scoreUserId, change }) =>
      change.type === "set"
        ? setScoreReaction(gameId, periodKey, scoreUserId, change.emoji, token)
        : removeScoreReaction(gameId, periodKey, scoreUserId, token),
    onMutate: async ({ gameId, scoreUserId, change }) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<TData>(queryKey);
      if (prev && viewer) {
        const next = applyViewerReaction(readReactions(prev, gameId, scoreUserId), viewer, change);
        queryClient.setQueryData<TData>(queryKey, writeReactions(prev, gameId, scoreUserId, next));
      }
      return { prev };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.prev !== undefined) queryClient.setQueryData(queryKey, ctx.prev);
      showToast({ message: errorMessage(e, "Couldn't react"), tone: "danger" });
    },
    onSuccess: (data, { gameId, scoreUserId }) => {
      haptics.light();
      // Reconcile against the server's authoritative summary for this score.
      const cur = queryClient.getQueryData<TData>(queryKey);
      if (cur) {
        queryClient.setQueryData<TData>(
          queryKey,
          writeReactions(cur, gameId, scoreUserId, data.reactions),
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const { mutate } = mutation;

  const react = useCallback(
    (gameId: string, scoreUserId: string, emoji: string, currentlyReacted: boolean) => {
      mutate({
        gameId,
        scoreUserId,
        change: currentlyReacted ? { type: "remove" } : { type: "set", emoji },
      });
    },
    [mutate],
  );

  const openPicker = useCallback(
    (gameId: string, scoreUserId: string, name: string | null) =>
      setTarget({ gameId, scoreUserId, name }),
    [],
  );
  const closePicker = useCallback(() => setTarget(null), []);

  // The viewer's current emoji on the targeted score (drives picker highlight + Remove).
  const data = queryClient.getQueryData<TData>(queryKey);
  const currentEmoji =
    target && data
      ? (readReactions(data, target.gameId, target.scoreUserId).find((r) => r.viewerReacted)
          ?.emoji ?? null)
      : null;

  const pick = useCallback(
    (emoji: string) => {
      if (!target) return;
      mutate({
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
    mutate({ gameId: target.gameId, scoreUserId: target.scoreUserId, change: { type: "remove" } });
    setTarget(null);
  }, [mutate, target]);

  return { target, react, openPicker, closePicker, currentEmoji, pick, removeReaction };
}
