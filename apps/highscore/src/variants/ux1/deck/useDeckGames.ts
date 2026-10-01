// Everything the deck needs from the games API, in one place.
//
// The cartridges, the strip, the shelf, the slot and the control panel are all
// views of the same data, so the queries and mutations live here and are
// handed down through `DeckDataProvider` rather than re-fetched per surface.
// Today's standings for *every* game arrive in the single `GET /v1/games`
// call, which is what makes the whole deck free to render; per-game history is
// fetched lazily by the day blocks that need it.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { createFriendInvite, fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { DiscoveryGame, Game, GamesResponse } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useCallback, useMemo, useState } from "react";
import {
  addGame,
  createGameShareLink,
  fetchGameDiscovery,
  fetchMyGames,
  moveGame,
  removeGame,
  setGameScoreSpec,
  upsertGameScore,
} from "../games/api/games";
import { useReturnToPaste } from "../games/hooks/useReturnToPaste";
import { localDateKey } from "../games/lib/gameDate";
import { neighborsForOrderedReorder } from "../games/lib/reorder";
import { buildTodaysGameScoresSummary } from "../games/lib/scoresSummary";
import { copyToClipboard, shareOrCopyLink } from "../games/lib/share";
import { useGamesRuntime } from "../games/runtime";
import type { TaughtScoreSpec } from "../games/screens/GameScorePasteSheet";
import { useToast } from "../theme";
import { monogramsFor } from "./monogram";

export function useDeckGames() {
  const { token, user } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const gamesKey = queryKeys.games.mine(todayKey);

  const gamesQuery = useQuery({
    queryKey: gamesKey,
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const myGames = gamesQuery.data?.games ?? [];
  const isEmpty = !gamesQuery.isPending && !gamesQuery.isError && myGames.length === 0;

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [scoreShareUrl, setScoreShareUrl] = useState<string | null>(null);
  const [copyingScores, setCopyingScores] = useState(false);
  const [addingDiscoveryIds, setAddingDiscoveryIds] = useState<string[]>([]);
  const [addedDiscoveryIds, setAddedDiscoveryIds] = useState<string[]>([]);

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const friends = friendsQuery.data?.friends ?? [];

  // Addable games only: the slot's job is putting a cartridge in, so rows you
  // can't act on are just padding.
  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(),
    queryFn: () => fetchGameDiscovery(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const discovery = discoveryQuery.data?.games ?? [];

  const addMutation = useMutation({
    mutationFn: (url: string) => addGame(url, token),
    onSuccess: async (data) => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: gamesKey });
      showToast({ message: `Added ${data.game.title}`, tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
  });

  const addDiscoveryMutation = useMutation({
    mutationFn: (game: DiscoveryGame) => addGame(game.game.url, token),
    onMutate: (game) => {
      setAddingDiscoveryIds((ids) => [...ids, game.game.id]);
    },
    onSuccess: async (_data, game) => {
      haptics.medium();
      setAddedDiscoveryIds((ids) => (ids.includes(game.game.id) ? ids : [...ids, game.game.id]));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gamesKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.discovery() }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
    onSettled: (_data, _e, game) => {
      setAddingDiscoveryIds((ids) => ids.filter((id) => id !== game.game.id));
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () => createFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      setInviteUrl(data.url);
      const result = await shareOrCopyLink(data.url);
      if (result === "copied") {
        showToast({ message: "Invite link copied", tone: "success" });
      } else if (result === "failed") {
        showToast({ message: "Couldn't copy — copy the link below manually.", tone: "danger" });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't create an invite link."), tone: "danger" });
    },
  });

  const copyInvite = useCallback(async () => {
    if (!inviteUrl) return;
    const result = await shareOrCopyLink(inviteUrl);
    if (result === "copied") showToast({ message: "Invite link copied", tone: "success" });
  }, [inviteUrl, showToast]);

  const moveMutation = useMutation<
    { position: number | null; rebalanced: boolean },
    Error,
    { gameId: string; beforeGameId: string | null; afterGameId: string | null; toIndex: number },
    { previous?: GamesResponse }
  >({
    mutationFn: ({ gameId, beforeGameId, afterGameId }) =>
      moveGame(gameId, { beforeGameId, afterGameId }, token),
    onMutate: async ({ gameId, toIndex }) => {
      await queryClient.cancelQueries({ queryKey: gamesKey });
      const previous = queryClient.getQueryData<GamesResponse>(gamesKey);
      if (previous) {
        const fromIndex = previous.games.findIndex((g) => g.gameId === gameId);
        if (fromIndex >= 0) {
          const next = previous.games.slice();
          const [moved] = next.splice(fromIndex, 1);
          if (moved) {
            next.splice(toIndex, 0, moved);
            queryClient.setQueryData<GamesResponse>(gamesKey, { ...previous, games: next });
          }
        }
      }
      return previous ? { previous } : {};
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(gamesKey, ctx.previous);
      showToast({ message: errorMessage(e, "Couldn't move that game."), tone: "danger" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gamesKey });
    },
  });

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      const neighbors = neighborsForOrderedReorder(myGames, fromIndex, toIndex);
      if (!neighbors) return;
      const moved = myGames[fromIndex];
      if (!moved) return;
      moveMutation.mutate({
        gameId: moved.gameId,
        beforeGameId: neighbors.before?.gameId ?? null,
        afterGameId: neighbors.after?.gameId ?? null,
        toIndex,
      });
    },
    [myGames, moveMutation],
  );

  const removeMutation = useMutation({
    mutationFn: (gameId: string) => removeGame(gameId, token),
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: gamesKey });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" });
    },
  });

  const hasMyScore = useCallback(
    (gameId: string) =>
      myGames.find((g) => g.gameId === gameId)?.standings.viewerHasPlayed ?? false,
    [myGames],
  );
  const returnToPaste = useReturnToPaste({
    todayKey,
    hasScoreForItem: hasMyScore,
    scope: "games",
  });

  // Editing a posted score reuses the paste sheet rather than a second
  // composer — one place in the app takes a pasted result.
  const [pasteDraft, setPasteDraft] = useState("");
  const openPasteFor = useCallback(
    (game: { id: string; url: string | null }, draft = "") => {
      setPasteDraft(draft);
      returnToPaste.openPasteFor(game);
    },
    [returnToPaste],
  );
  const markPlaying = useCallback(
    (game: { id: string; url: string | null }) => {
      setPasteDraft("");
      returnToPaste.markPlaying(game);
    },
    [returnToPaste],
  );

  const upsertMutation = useMutation({
    mutationFn: async ({
      game,
      scoreRaw,
      taught,
    }: {
      game: Game;
      scoreRaw: string;
      taught?: TaughtScoreSpec;
    }) => {
      if (taught) await setGameScoreSpec(game.id, taught, token);
      return upsertGameScore(game.id, { periodKey: todayKey, scoreRaw }, token);
    },
    onSuccess: async (_data, { game }) => {
      haptics.medium();
      returnToPaste.dismiss();
      setPasteDraft("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: gamesKey }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(game.id, todayKey),
        }),
      ]);
      // No toast: the row appearing on today's board is the confirmation.
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  // Plate monograms are deck-wide so two similarly-named games never wear the
  // same label. Keyed on the titles rather than the array identity so a
  // standings refetch doesn't recompute them.
  const titleKey = myGames.map((g) => g.game.title).join("\u0000");
  const monograms = useMemo(() => monogramsFor(titleKey.split("\u0000")), [titleKey]);

  const playedToday = myGames.some((g) => g.standings.viewerHasPlayed);

  const copyScores = useCallback(async () => {
    const selfId = user?.id ?? null;
    const preview = buildTodaysGameScoresSummary({
      shareUrl: "",
      games: myGames,
      selfId,
      dateKey: todayKey,
    });
    if (!preview) {
      showToast({
        message: "No scores from you today yet. Post one to share a recap.",
        tone: "default",
      });
      return;
    }
    try {
      setCopyingScores(true);
      let url = scoreShareUrl;
      if (!url) {
        const link = await createGameShareLink(token);
        url = link.url;
        setScoreShareUrl(url);
      }
      const summary = buildTodaysGameScoresSummary({
        shareUrl: url,
        games: myGames,
        selfId,
        dateKey: todayKey,
      });
      if (!summary) return;
      const ok = await copyToClipboard(summary);
      if (ok) haptics.light();
      showToast({
        message: ok ? "Today's scores copied" : "Couldn't copy to clipboard",
        tone: ok ? "success" : "danger",
      });
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't create a share link."), tone: "danger" });
    } finally {
      setCopyingScores(false);
    }
  }, [myGames, scoreShareUrl, showToast, todayKey, token, user?.id]);

  const pasteTarget: Game | null =
    (returnToPaste.promptItemId
      ? myGames.find((g) => g.gameId === returnToPaste.promptItemId)?.game
      : null) ?? null;

  return {
    todayKey,
    gamesQuery,
    myGames,
    monograms,
    isEmpty,
    friends,
    friendsLoading: friendsQuery.isLoading,
    discovery,
    discoveryLoading: discoveryQuery.isLoading,
    addMutation,
    addDiscovery: (game: DiscoveryGame) => addDiscoveryMutation.mutate(game),
    addingDiscoveryIds,
    addedDiscoveryIds,
    invite: () => inviteMutation.mutate(),
    invitePending: inviteMutation.isPending,
    inviteUrl,
    copyInvite,
    reorder,
    removeGame: (gameId: string) => removeMutation.mutate(gameId),
    markPlaying,
    openPasteFor,
    dismissPaste: () => {
      setPasteDraft("");
      returnToPaste.dismiss();
    },
    pasteTarget,
    pasteDraft,
    upsertMutation,
    playedToday,
    copyScores,
    copyingScores,
  } as const;
}

export type DeckGames = ReturnType<typeof useDeckGames>;
