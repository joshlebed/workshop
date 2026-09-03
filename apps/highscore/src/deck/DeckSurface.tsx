// The deck: a horizontal run of full-screen cartridges with the slot at the
// end, the position strip above it, and the shelf zoomed out over the top.
//
// Swiping between games is the app's primary navigation and it is direct
// manipulation — the pager and the strip's underline move with your finger.
// Everything else (tapping a strip cell, opening the shelf, closing it) is the
// same two-frame step used across the app.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { zoomStepped } from "../theme";
import { Cartridge } from "./Cartridge";
import { DeckStrip } from "./DeckStrip";
import { Shelf } from "./Shelf";
import { SlotCartridge } from "./SlotCartridge";
import type { DeckGames } from "./useDeckGames";

interface DeckSurfaceProps {
  data: DeckGames;
  /** Which cartridge to park on — set by deep links and by the shelf. */
  gameId: string | null;
  onGameIdChange: (gameId: string | null) => void;
  shelfOpen: boolean;
  onShelfOpenChange: (open: boolean) => void;
}

export function DeckSurface({
  data,
  gameId,
  onGameIdChange,
  shelfOpen,
  onShelfOpenChange,
}: DeckSurfaceProps) {
  const games = data.myGames;
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const scrollX = useSharedValue(0);
  const lastIndex = useSharedValue(0);
  const pagerRef = useAnimatedRef<Animated.ScrollView>();
  // The shelf stays mounted through its exit so the zoom can play out.
  const [shelfMounted, setShelfMounted] = useState(shelfOpen);
  const zoom = useSharedValue(shelfOpen ? 1 : 0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const scrollToIndex = useCallback(
    (next: number, animated = true) => {
      if (width <= 0) return;
      pagerRef.current?.scrollTo({ x: next * width, y: 0, animated });
    },
    [pagerRef, width],
  );

  // A deep link (or the shelf) names a game; park the pager on it.
  const requestedIndex = gameId ? games.findIndex((g) => g.gameId === gameId) : -1;
  const pendingRef = useRef<number | null>(null);
  useEffect(() => {
    if (requestedIndex < 0 || width <= 0) return;
    if (pendingRef.current === requestedIndex) return;
    pendingRef.current = requestedIndex;
    setIndex(requestedIndex);
    scrollToIndex(requestedIndex, false);
  }, [requestedIndex, width, scrollToIndex]);

  const setIndexFromScroll = useCallback(
    (next: number) => {
      pendingRef.current = next;
      setIndex(next);
      onGameIdChange(games[next]?.gameId ?? null);
    },
    [games, onGameIdChange],
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
      if (width <= 0) return;
      const next = Math.round(e.contentOffset.x / width);
      if (next !== lastIndex.value) {
        lastIndex.value = next;
        runOnJS(setIndexFromScroll)(next);
      }
    },
  });

  useEffect(() => {
    if (shelfOpen) setShelfMounted(true);
    zoom.value = withTiming(shelfOpen ? 1 : 0, zoomStepped, (finished) => {
      if (finished && !shelfOpen) runOnJS(setShelfMounted)(false);
    });
  }, [shelfOpen, zoom]);

  // Pinch out on the deck to reach the shelf; the strip's mark is the tap
  // affordance for platforms and users without the gesture.
  const pinch = Gesture.Pinch().onEnd((e) => {
    if (e.scale < 0.86) runOnJS(onShelfOpenChange)(true);
  });

  const deckStyle = useAnimatedStyle(() => ({
    opacity: 1 - zoom.value,
    transform: [{ scale: 1 - zoom.value * 0.12 }],
  }));
  const shelfStyle = useAnimatedStyle(() => ({
    opacity: zoom.value,
    transform: [{ scale: 0.94 + zoom.value * 0.06 }],
  }));

  const onSelectCell = useCallback(
    (next: number) => {
      setIndex(next);
      pendingRef.current = next;
      lastIndex.value = next;
      onGameIdChange(games[next]?.gameId ?? null);
      // A jump of more than one cartridge cuts rather than flies: sliding
      // past eight games is slow, and re-rendering the pager mid-animation
      // fights the scroll. A cut is also the most stepped transition there is.
      scrollToIndex(next, Math.abs(next - index) <= 1);
    },
    [games, lastIndex, onGameIdChange, scrollToIndex, index],
  );

  return (
    <View style={styles.root} onLayout={onLayout}>
      <DeckStrip
        games={games}
        monograms={data.monograms}
        index={index}
        scrollX={scrollX}
        pageWidth={width}
        onSelect={onSelectCell}
        onOpenShelf={() => onShelfOpenChange(!shelfOpen)}
        shelfOpen={shelfOpen}
      />

      <View style={styles.stage}>
        <GestureDetector gesture={pinch}>
          <Animated.View
            style={[styles.layer, deckStyle, { pointerEvents: shelfOpen ? "none" : "auto" }]}
          >
            {width > 0 ? (
              <Animated.ScrollView
                ref={pagerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                testID="deck-pager"
              >
                {games.map((mg, i) => (
                  <Cartridge
                    key={mg.gameId}
                    myGame={mg}
                    mark={data.monograms.get(mg.game.title)}
                    todayKey={data.todayKey}
                    width={width}
                    active={i === index}
                    onPlay={() => data.markPlaying({ id: mg.gameId, url: mg.game.url })}
                    onPaste={(draft) =>
                      data.openPasteFor({ id: mg.gameId, url: mg.game.url }, draft)
                    }
                    onRemove={() => data.removeGame(mg.gameId)}
                  />
                ))}
                <SlotCartridge
                  width={width}
                  deckEmpty={games.length === 0}
                  hasFriends={data.friends.length > 0}
                  friendsLoading={data.friendsLoading}
                  discovery={data.discovery}
                  discoveryLoading={data.discoveryLoading}
                  addingGameIds={data.addingDiscoveryIds}
                  addedGameIds={data.addedDiscoveryIds}
                  addPending={data.addMutation.isPending}
                  onAddUrl={(url) => data.addMutation.mutate(url)}
                  onAddDiscovery={data.addDiscovery}
                  invitePending={data.invitePending}
                  inviteUrl={data.inviteUrl}
                  onInvite={data.invite}
                  onCopyInvite={data.copyInvite}
                />
              </Animated.ScrollView>
            ) : null}
          </Animated.View>
        </GestureDetector>

        {shelfMounted ? (
          <Animated.View
            style={[styles.layer, shelfStyle, { pointerEvents: shelfOpen ? "auto" : "none" }]}
          >
            <Shelf
              games={games}
              monograms={data.monograms}
              activeIndex={index}
              showRecap={data.playedToday}
              recapBusy={data.copyingScores}
              onRecap={data.copyScores}
              onOpen={(i) => {
                onShelfOpenChange(false);
                onSelectCell(i);
              }}
              onReorder={data.reorder}
              onClose={() => onShelfOpenChange(false)}
            />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  stage: { flex: 1 },
  layer: { ...StyleSheet.absoluteFillObject },
});
