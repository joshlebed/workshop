// Add a game — a full screen (like Paste score), reached from the home
// action bar's "Add game" and the empty state. A "Friends only" checkbox
// (default on) over one sectioned list (`GameCatalogList`, grouped by game
// type via `lib/catalogSections`):
//
//   on  — only games your friends play, each saying how many and which
//         friends; types ordered by the game most of your friends play.
//         Backed by `GET /v1/games/discovery?includeOwned=1`.
//   off — the official catalog (operator-reviewed, see
//         docs/catalog-ops-runbook.md): every listed game with a
//         platform-wide player count and no names. Same ordering.
//
// Both modes add in place: tap Add, the row flips to "✓ Added", keep browsing.
// A game you already have opens its board. The footer keeps the bootstrap
// path — paste any game's URL (spec §3.3: known dailies collapse onto their
// catalog row, unknown URLs get a link-preview title + favicon) — which adds
// and returns home. That footer is `addByUrl/AddByUrlFooter.tsx`, currently in
// five treatments under evaluation (picker in the footer, persisted).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { Game } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, EmptyState, PixelIcon, Screen, Text, tokens, useToast } from "../../../theme";
import { addGame, fetchGameCatalog, fetchGameDiscovery } from "../../api/games";
import { FriendsOnlyToggle } from "../../components/FriendsOnlyToggle";
import {
  type CatalogRow,
  catalogRows,
  friendsFeedRows,
  groupCatalogRows,
} from "../../lib/catalogSections";
import { localDateKey } from "../../lib/gameDate";
import { goBack } from "../../lib/navigation";
import { useGamesRuntime } from "../../runtime";
import { AddByUrlFooter } from "./addByUrl/AddByUrlFooter";
import { GameCatalogList } from "./GameCatalogList";

export function AddGame() {
  const { token, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const insets = useSafeAreaInsets();
  const todayKey = localDateKey();

  const [friendsOnly, setFriendsOnly] = useState(true);
  // Per-row add state so each row shows its own spinner / "✓ Added" pill.
  const [addingIds, setAddingIds] = useState<string[]>([]);
  const [addedIds, setAddedIds] = useState<string[]>([]);

  const onFriends = friendsOnly;

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token && onFriends,
  });
  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(),
    queryFn: () => fetchGameDiscovery(token, { includeOwned: true }),
    enabled: !!token && onFriends,
    refetchInterval: livePoll,
  });
  const catalogQuery = useQuery({
    queryKey: queryKeys.games.catalog,
    queryFn: () => fetchGameCatalog(token),
    enabled: !!token && !onFriends,
    refetchInterval: livePoll,
  });
  const activeQuery = onFriends ? discoveryQuery : catalogQuery;

  const sections = useMemo(
    () =>
      onFriends
        ? groupCatalogRows(friendsFeedRows(discoveryQuery.data?.games ?? []))
        : groupCatalogRows(catalogRows(catalogQuery.data?.games ?? [])),
    [onFriends, discoveryQuery.data, catalogQuery.data],
  );

  const invalidateGameLists = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(todayKey) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.games.discovery() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.games.catalog }),
    ]);

  // One-tap add of a row: stays on this screen, flips the row in place.
  const addRowMutation = useMutation({
    mutationFn: (game: Pick<Game, "id" | "url">) => addGame(game.url, token),
    onMutate: (game) => {
      setAddingIds((ids) => [...ids, game.id]);
    },
    onSuccess: async (_data, game) => {
      haptics.medium();
      setAddedIds((ids) => (ids.includes(game.id) ? ids : [...ids, game.id]));
      await invalidateGameLists();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
    onSettled: (_data, _e, game) => {
      setAddingIds((ids) => ids.filter((id) => id !== game.id));
    },
  });

  // URL add (footer): the game lands on the home list, so go there.
  const onUrlAdded = async (game: Game) => {
    await invalidateGameLists();
    showToast({ message: `Added ${game.title}`, tone: "success" });
    goBack(routes.home);
  };

  const friends = friendsQuery.data?.friends ?? [];

  const empty = activeQuery.isPending ? (
    <ActivityIndicator color={tokens.accent.default} />
  ) : activeQuery.isError ? (
    <EmptyState
      title={onFriends ? "Couldn't load your friends' games" : "Couldn't load the catalog"}
      description={errorMessage(activeQuery.error)}
      action={<Button label="Retry" variant="secondary" onPress={() => activeQuery.refetch()} />}
    />
  ) : onFriends && !friendsQuery.isPending && friends.length === 0 ? (
    <EmptyState
      title="See what your friends play"
      description="Add a friend and their games show up here, grouped by type."
      action={
        <Button
          label="Add friends"
          onPress={() => router.push(routes.friends as Href)}
          testID="add-game-go-friends"
        />
      }
    />
  ) : onFriends ? (
    <EmptyState
      title="No games yet"
      description="Your friends haven't added any games. Browse the catalog to find one."
      action={
        <Button label="Show every game" variant="secondary" onPress={() => setFriendsOnly(false)} />
      }
    />
  ) : (
    <EmptyState title="The catalog is empty" description="Paste a game's URL below to add one." />
  );

  return (
    // The URL footer is pinned to the bottom, so without keyboard avoidance
    // the iOS keyboard slides up over it and the input you just tapped is
    // hidden. keyboard-controller measures this view in *parent* coordinates
    // (onLayout, not measureInWindow) and the root layout's top-edge
    // SafeAreaView shifts every screen down by `insets.top`, so without the
    // offset the padding is short by exactly that much (verified on iOS 26:
    // 246pt applied vs a 309pt keyboard).
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <Screen style={styles.root} testID="add-game-screen">
        <View style={styles.headerNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => goBack(routes.home)}
            testID="add-game-back"
            hitSlop={10}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
          </Pressable>
          <Text variant="title">Add a game</Text>
          <View style={styles.navButton} />
        </View>

        <FriendsOnlyToggle value={friendsOnly} onChange={setFriendsOnly} />

        <View style={styles.body}>
          <GameCatalogList
            sections={sections}
            addingGameIds={addingIds}
            addedGameIds={addedIds}
            onAdd={(row: CatalogRow) => addRowMutation.mutate(row.game)}
            onOpen={(gameId) => router.push(routes.game(gameId) as Href)}
            refreshing={activeQuery.isRefetching && !activeQuery.isPending}
            onRefresh={() => activeQuery.refetch()}
            bottomInset={0}
            empty={empty}
            testIDPrefix={onFriends ? "friends-games" : "catalog-games"}
          />
        </View>

        <AddByUrlFooter onAdded={onUrlAdded} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  body: { flex: 1, minHeight: 0 },
});
