// Zoom out and the deck becomes a shelf: every cartridge at once, three
// across, each carrying a seven-day turnout strip so you can see which games
// went quiet without opening them.
//
// Reordering lives here, not on a list. Long-press a tile and drag it across
// the grid; the others step aside a slot at a time. One implementation drives
// both platforms — gesture-handler works on web, so there is no dnd-kit build
// and no native reorderable list.

import type { MyGame } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Wordmark } from "../components/Wordmark";
import { deck, PixelIcon, stepped, Text, tokens } from "../theme";
import { CartridgeLabel } from "./CartridgeLabel";

const GAP = tokens.space.sm;
const TILE_H = 96;

interface ShelfProps {
  games: MyGame[];
  monograms: Map<string, string>;
  activeIndex: number;
  /** Copying today's scores spans every game, so it lives here, once. */
  showRecap: boolean;
  recapBusy: boolean;
  onRecap: () => void;
  onOpen: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClose: () => void;
}

export function Shelf({
  games,
  monograms,
  activeIndex,
  showRecap,
  recapBusy,
  onRecap,
  onOpen,
  onReorder,
  onClose,
}: ShelfProps) {
  const [width, setWidth] = useState(0);
  // Which slot the dragged tile currently claims — every other tile derives
  // its resting slot from this, so the grid reflows a slot at a time.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  const cols = deck.shelfColumns;
  const tileW = width > 0 ? (width - GAP * (cols - 1)) / cols : 0;

  const commit = useCallback(
    (from: number, to: number) => {
      setDragIndex(null);
      setHoverIndex(null);
      if (from !== to) onReorder(from, to);
    },
    [onReorder],
  );

  return (
    <View style={styles.root} testID="deck-shelf">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to the deck"
        onPress={onClose}
        testID="deck-shelf-close"
        style={({ pressed }) => [styles.header, pressed && styles.headerPressed]}
      >
        <Wordmark />
      </Pressable>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.grid} onLayout={onLayout}>
          {tileW > 0
            ? games.map((mg, i) => (
                <ShelfTile
                  key={mg.gameId}
                  myGame={mg}
                  mark={monograms.get(mg.game.title)}
                  index={i}
                  slot={slotFor(i, dragIndex, hoverIndex)}
                  tileW={tileW}
                  cols={cols}
                  count={games.length}
                  isCurrent={i === activeIndex}
                  dragging={dragIndex === i}
                  onOpen={() => onOpen(i)}
                  onDragStart={() => {
                    setDragIndex(i);
                    setHoverIndex(i);
                  }}
                  onDragMove={setHoverIndex}
                  onDragEnd={(to) => commit(i, to)}
                />
              ))
            : null}
          {tileW > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a game"
              onPress={() => onOpen(games.length)}
              testID="shelf-tile-slot"
              style={({ pressed }) => [
                styles.tileWrap,
                styles.slot,
                {
                  width: tileW,
                  height: TILE_H,
                  left: (games.length % cols) * (tileW + GAP),
                  top: Math.floor(games.length / cols) * (TILE_H + GAP),
                },
                pressed && styles.tilePressed,
              ]}
            >
              <PixelIcon name="plus" size={24} color={tokens.text.secondary} />
            </Pressable>
          ) : null}
          {/* Height comes from absolutely-positioned tiles, so the grid needs
              an explicit one. */}
          <View style={{ height: rowsFor(games.length + 1, cols) * (TILE_H + GAP) }} />
        </View>
        {showRecap ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy today's scores to clipboard"
            onPress={onRecap}
            disabled={recapBusy}
            testID="games-copy-scores"
            style={({ pressed }) => [styles.recap, pressed && styles.recapPressed]}
          >
            {recapBusy ? (
              <ActivityIndicator size="small" color={tokens.text.secondary} />
            ) : (
              <PixelIcon name="copy" size={16} color={tokens.text.secondary} />
            )}
            <Text variant="heading" tone="secondary" style={styles.recapLabel}>
              Copy today's scores
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Where tile `i` rests while `drag` is hovering over slot `hover`. */
function slotFor(i: number, drag: number | null, hover: number | null): number {
  if (drag === null || hover === null) return i;
  if (i === drag) return hover;
  if (drag < hover && i > drag && i <= hover) return i - 1;
  if (drag > hover && i >= hover && i < drag) return i + 1;
  return i;
}

function rowsFor(count: number, cols: number): number {
  return Math.max(1, Math.ceil(count / cols));
}

interface ShelfTileProps {
  myGame: MyGame;
  mark: string | undefined;
  index: number;
  slot: number;
  tileW: number;
  cols: number;
  count: number;
  isCurrent: boolean;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragMove: (slot: number) => void;
  onDragEnd: (slot: number) => void;
}

function ShelfTile({
  myGame,
  mark,
  slot,
  tileW,
  cols,
  count,
  isCurrent,
  dragging,
  onOpen,
  onDragStart,
  onDragMove,
  onDragEnd,
}: ShelfTileProps) {
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const lifted = useSharedValue(0);
  const slotShared = useSharedValue(slot);
  slotShared.value = slot;

  const stepX = tileW + GAP;
  const stepY = TILE_H + GAP;

  const slotAt = (x: number, y: number): number => {
    "worklet";
    const col = Math.max(0, Math.min(cols - 1, Math.round(x / stepX)));
    const row = Math.max(0, Math.floor(y / stepY + 0.5));
    return Math.max(0, Math.min(count - 1, row * cols + col));
  };

  const pan = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      lifted.value = withTiming(1, stepped);
      runOnJS(onDragStart)();
      runOnJS(haptics.selection)();
    })
    .onUpdate((e) => {
      dx.value = e.translationX;
      dy.value = e.translationY;
      const homeX = (slotShared.value % cols) * stepX;
      const homeY = Math.floor(slotShared.value / cols) * stepY;
      runOnJS(onDragMove)(slotAt(homeX + e.translationX, homeY + e.translationY));
    })
    .onEnd(() => {
      const homeX = (slotShared.value % cols) * stepX;
      const homeY = Math.floor(slotShared.value / cols) * stepY;
      const target = slotAt(homeX + dx.value, homeY + dy.value);
      dx.value = 0;
      dy.value = 0;
      lifted.value = withTiming(0, stepped);
      runOnJS(onDragEnd)(target);
    });

  const style = useAnimatedStyle(() => {
    const homeX = (slotShared.value % cols) * stepX;
    const homeY = Math.floor(slotShared.value / cols) * stepY;
    return {
      left: dragging ? homeX : withTiming(homeX, stepped),
      top: dragging ? homeY : withTiming(homeY, stepped),
      transform: [
        { translateX: dx.value },
        { translateY: dy.value },
        { scale: 1 + lifted.value * 0.06 },
      ],
      zIndex: dragging ? 10 : 1,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.tileWrap, { width: tileW, height: TILE_H }, style]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${myGame.game.title}`}
          accessibilityHint="Long press and drag to move this game"
          onPress={onOpen}
          testID={`shelf-tile-${myGame.gameId}`}
          style={({ pressed }) => [
            styles.tile,
            isCurrent && styles.tileCurrent,
            (pressed || dragging) && styles.tilePressed,
          ]}
        >
          <View style={styles.grip} />
          <CartridgeLabel title={myGame.game.title} mark={mark} size={36} active={isCurrent} />
          <Text variant="caption" numberOfLines={2} style={styles.tileTitle}>
            {myGame.game.title}
          </Text>
          <TodayMarks myGame={myGame} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Today's board for this game, as marks: one per player who has posted, plus
 * your own slot at the end — filled chartreuse when you've played, an empty
 * pink outline when you haven't. That empty slot is the whole "you still owe
 * this one" signal, so the shelf needs no badges and no counts.
 */
function TodayMarks({ myGame }: { myGame: MyGame }) {
  const played = myGame.standings.entries.filter(
    (e) => e.scoreRaw != null && e.scoreRaw.length > 0,
  );
  const mine = myGame.standings.viewerHasPlayed;
  const others = Math.min(played.length - (mine ? 1 : 0), 6);
  return (
    <View
      style={styles.marks}
      accessible
      accessibilityLabel={
        mine
          ? `Played today, ${played.length} on the board`
          : played.length > 0
            ? `${played.length} played today, you haven't`
            : "Nobody has played today"
      }
    >
      {Array.from({ length: Math.max(0, others) }, (_, i) => (
        // Positional marks — index is the identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional marks
        <View key={i} style={styles.mark} />
      ))}
      <View style={mine ? styles.markMine : styles.markSlot} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    height: deck.stripHeight,
    justifyContent: "center",
    paddingHorizontal: tokens.space.lg,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  headerPressed: { backgroundColor: tokens.bg.surface },
  scroll: { padding: tokens.space.lg },
  grid: { position: "relative" },
  tileWrap: { position: "absolute" },
  tile: {
    flex: 1,
    padding: tokens.space.sm,
    justifyContent: "space-between",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  // The grip notch off a cartridge's top edge — the one ornament on the tile.
  grip: {
    position: "absolute",
    top: 0,
    alignSelf: "center",
    width: 20,
    height: tokens.bezel,
    backgroundColor: tokens.border.default,
  },
  tileCurrent: { borderColor: tokens.neon.pink },
  slot: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderStyle: "dashed",
  },
  tilePressed: { backgroundColor: tokens.bg.raised },
  tileTitle: { fontSize: 12, lineHeight: 15, paddingTop: tokens.space.xs },
  marks: { flexDirection: "row", gap: 3, minHeight: 8 },
  mark: { width: 6, height: 6, backgroundColor: tokens.text.secondary },
  markMine: { width: 6, height: 6, backgroundColor: tokens.neon.chartreuse },
  markSlot: { width: 6, height: 6, borderWidth: tokens.bezel, borderColor: tokens.neon.pink },
  recap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    height: 44,
    marginTop: tokens.space.lg,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  recapPressed: { backgroundColor: tokens.bg.surface },
  recapLabel: { fontSize: 10, lineHeight: 16 },
});
