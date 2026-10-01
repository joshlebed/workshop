// The app, singular. One screen holds the deck, the players panel and the you
// panel; the control panel switches between them with a two-frame step. The
// paste sheet lives here too, so returning from a game pops it no matter which
// panel you happen to be on.

import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { fetchFriendRequests } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { isGameReteachable, specForGame } from "../games/lib/scoreSpecs";
import { useGamesRuntime } from "../games/runtime";
import { GameScorePasteSheet } from "../games/screens/GameScorePasteSheet";
import { Button, deck, Screen, stepped, Text, tokens } from "../theme";
import { ControlPanel } from "./ControlPanel";
import { type Panel, panelDelta, useDeckNav } from "./DeckNav";
import { DeckSurface } from "./DeckSurface";
import { PlayersPanel } from "./PlayersPanel";
import { useDeckGames } from "./useDeckGames";
import { YouPanel } from "./YouPanel";

export function AppShell() {
  const nav = useDeckNav();
  const data = useDeckGames();
  const { token, user } = useGamesRuntime();
  const livePoll = useLivePollingInterval();

  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pendingRequests = requestsQuery.data?.inbound.length ?? 0;

  return (
    <Screen testID="games-home">
      <View style={styles.stage}>
        <PanelSwitch panel={nav.panel}>
          {nav.panel === "deck" ? (
            data.gamesQuery.isPending ? (
              <View style={styles.center}>
                <ActivityIndicator color={tokens.neon.pink} />
              </View>
            ) : data.gamesQuery.isError ? (
              <View style={styles.center}>
                <Text tone="danger" style={styles.centerText}>
                  {errorMessage(data.gamesQuery.error, "Couldn't load your games.")}
                </Text>
                <Button
                  label="Retry"
                  variant="secondary"
                  onPress={() => data.gamesQuery.refetch()}
                />
              </View>
            ) : (
              <DeckSurface
                data={data}
                gameId={nav.gameId}
                onGameIdChange={nav.setGameId}
                shelfOpen={nav.shelfOpen}
                onShelfOpenChange={nav.setShelfOpen}
              />
            )
          ) : nav.panel === "players" ? (
            <PlayersPanel
              playerId={nav.playerId}
              playerVia={nav.playerVia}
              onOpenPlayer={nav.openPlayer}
              onClosePlayer={nav.closePlayer}
              onOpenGame={nav.openGame}
            />
          ) : (
            <YouPanel />
          )}
        </PanelSwitch>
      </View>

      <ControlPanel panel={nav.panel} onSelect={nav.setPanel} pendingRequests={pendingRequests} />

      <GameScorePasteSheet
        item={data.pasteTarget}
        initialDraft={data.pasteDraft}
        userName={user?.displayName ?? null}
        userAvatarUrl={user?.avatarUrl ?? null}
        pending={data.upsertMutation.isPending}
        spec={data.pasteTarget ? specForGame(data.pasteTarget) : null}
        canReteach={
          !!user?.isAdmin && data.pasteTarget != null && isGameReteachable(data.pasteTarget)
        }
        onTeach={(game, scoreRaw, taught) => data.upsertMutation.mutate({ game, scoreRaw, taught })}
        onSubmit={(game, scoreRaw) => data.upsertMutation.mutate({ game, scoreRaw })}
        onClose={data.dismissPaste}
      />
    </Screen>
  );
}

/**
 * Crossfade plus one 8px step in the direction of travel. The outgoing panel
 * is never on screen at the same time as the incoming one — this is a machine
 * changing state, not a card sliding over another card.
 */
function PanelSwitch({ panel, children }: { panel: Panel; children: React.ReactNode }) {
  const progress = useSharedValue(1);
  const offset = useSharedValue(0);
  const previous = useRef<Panel>(panel);

  useEffect(() => {
    const delta = panelDelta(previous.current, panel);
    previous.current = panel;
    if (delta === 0) return;
    offset.value = Math.sign(delta) * deck.step;
    progress.value = 0;
    progress.value = withTiming(1, stepped);
    offset.value = withTiming(0, stepped);
  }, [panel, offset, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: offset.value }],
  }));

  return <Animated.View style={[styles.panel, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  panel: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.md,
    padding: tokens.space.lg,
  },
  centerText: { textAlign: "center" },
});
