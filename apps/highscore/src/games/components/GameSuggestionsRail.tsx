// "What to play next" (spike 5) — co-play suggestions with a reason line and
// one-tap Add. Three surfaces: the game board after a score (≤3 rows), the
// 1–2-game home below the cards, and the post-accept picker's last page.
// `useGameSuggestions` owns the query, the add mutation and the
// instrumentation (impressions once per surface + game per session, adds,
// dismissals); `GameSuggestionsRail` is the titled, dismissable block the
// board and home render. Ranking, reasons and the content gate are the
// server's (`GET /v1/games/suggestions`).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GameSuggestionSurface } from "@workshop/shared/constants";
import type { DiscoveryGame, GameSuggestion } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { IconButton, PixelIcon, Text, tokens, useToast } from "../../theme";
import { addGame, fetchGameSuggestions, postGameSuggestionEvents } from "../api/games";
import { SUGGESTION_ROWS, suggestionReasonLine } from "../lib/gameSuggestions";
import { dismissSuggestions, takeUnreportedImpressions } from "../lib/suggestionSession";
import { useGamesRuntime } from "../runtime";
import { FriendGameSuggestions } from "../screens/games/FriendGameSuggestions";

export function useGameSuggestions(surface: GameSuggestionSurface, enabled: boolean) {
  const { token } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const rows = SUGGESTION_ROWS[surface];
  const [adding, setAdding] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);

  const query = useQuery({
    queryKey: queryKeys.games.suggestions(rows),
    queryFn: () => fetchGameSuggestions(token, rows),
    enabled: enabled && !!token,
    // Stable while on screen: an added row flips to "✓ Added" instead of
    // being replaced. A fresh mount refetches.
    refetchOnWindowFocus: false,
  });
  const suggestions = useMemo(
    () => (query.data?.suggestions ?? []).slice(0, rows),
    [query.data, rows],
  );

  const report = (
    event: "impression" | "add" | "dismiss",
    list: { s: GameSuggestion; rank: number }[],
  ) => {
    if (list.length === 0) return;
    postGameSuggestionEvents(
      surface,
      list.map(({ s, rank }) => ({ event, gameId: s.game.id, reasonKind: s.reason.kind, rank })),
      token,
    ).catch(() => {
      // Instrumentation never bothers the user.
    });
  };

  // Impressions: once per surface + game per session, when the rows render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: report is stable in effect
  useEffect(() => {
    if (!enabled || suggestions.length === 0) return;
    const fresh = new Set(
      takeUnreportedImpressions(
        surface,
        suggestions.map((s) => s.game.id),
      ),
    );
    report(
      "impression",
      suggestions.flatMap((s, rank) => (fresh.has(s.game.id) ? [{ s, rank }] : [])),
    );
  }, [enabled, suggestions, surface]);

  const addMutation = useMutation({
    mutationFn: (s: GameSuggestion) => addGame(s.game.url, token),
    onMutate: (s) => setAdding((ids) => [...ids, s.game.id]),
    onSuccess: async (_data, s) => {
      haptics.medium();
      setAdded((ids) => (ids.includes(s.game.id) ? ids : [...ids, s.game.id]));
      report("add", [{ s, rank: suggestions.findIndex((x) => x.game.id === s.game.id) }]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["games", "mine"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.discovery() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.catalog }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
    onSettled: (_d, _e, s) => setAdding((ids) => ids.filter((id) => id !== s.game.id)),
  });

  return {
    suggestions,
    isLoading: query.isLoading,
    adding,
    added,
    add: (s: GameSuggestion) => addMutation.mutate(s),
    dismiss: () => {
      report(
        "dismiss",
        suggestions.map((s, rank) => ({ s, rank })),
      );
      dismissSuggestions(surface);
    },
  };
}

type SuggestionsState = ReturnType<typeof useGameSuggestions>;

/** The rows: `FriendGameSuggestions` with each game's reason as its caption. */
export function GameSuggestionRows({
  state,
  testIDPrefix,
}: {
  state: SuggestionsState;
  testIDPrefix: string;
}) {
  const byId = useMemo(
    () => new Map(state.suggestions.map((s) => [s.game.id, s])),
    [state.suggestions],
  );
  const games: DiscoveryGame[] = state.suggestions.map((s) => ({
    game: s.game,
    friends: [],
    inMyGames: false,
  }));
  return (
    <FriendGameSuggestions
      games={games}
      addingGameIds={state.adding}
      addedGameIds={state.added}
      onAdd={(dg) => {
        const s = byId.get(dg.game.id);
        if (s) state.add(s);
      }}
      captionFor={(dg) => {
        const s = byId.get(dg.game.id);
        return s ? suggestionReasonLine(s.reason) : "";
      }}
      testIDPrefix={testIDPrefix}
    />
  );
}

/** Titled, dismissable rail (board + home). Renders nothing until it has rows. */
export function GameSuggestionsRail({
  surface,
  style,
}: {
  surface: Exclude<GameSuggestionSurface, "post_accept">;
  style?: object;
}) {
  const state = useGameSuggestions(surface, true);
  if (state.suggestions.length === 0) return null;
  return (
    <View style={[styles.rail, style]} testID={`suggestions-${surface}`}>
      <View style={styles.header}>
        <Text variant="label" style={styles.title}>
          What to play next
        </Text>
        <IconButton
          accessibilityLabel="Hide suggestions"
          onPress={state.dismiss}
          testID={`suggestions-${surface}-dismiss`}
        >
          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
        </IconButton>
      </View>
      <GameSuggestionRows state={state} testIDPrefix={`suggestions-${surface}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { gap: tokens.space.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: tokens.text.secondary },
});
