// The deck's position indicator: one cell per cartridge, plus the slot at the
// end. The underline tracks the pager 1:1 while you drag — it is the only
// thing in the app that moves continuously, because it is direct manipulation
// rather than a transition.
//
// The left cell is the shelf key: it holds the mark, and it is the tap
// affordance for the pinch-to-zoom-out gesture (web has no pinch).

import type { MyGame } from "@workshop/shared/games";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { BrandIcon } from "../components/BrandIcon";
import { deck, glow, PixelIcon, tokens } from "../theme";
import { CartridgeLabel } from "./CartridgeLabel";

const CELL_MIN = 30;
const CELL_MAX = 48;

export function cellWidth(count: number, available: number): number {
  if (count <= 0 || available <= 0) return CELL_MAX;
  return Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(available / count)));
}

interface DeckStripProps {
  games: MyGame[];
  monograms: Map<string, string>;
  index: number;
  /** Horizontal pager offset in pixels — drives the underline. */
  scrollX: SharedValue<number>;
  pageWidth: number;
  onSelect: (index: number) => void;
  onOpenShelf: () => void;
  shelfOpen: boolean;
}

export function DeckStrip({
  games,
  monograms,
  index,
  scrollX,
  pageWidth,
  onSelect,
  onOpenShelf,
  shelfOpen,
}: DeckStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [available, setAvailable] = useState(0);
  const count = games.length + 1;
  const cell = cellWidth(count, available);

  // Keep the active cell reachable when the deck is longer than the strip.
  useEffect(() => {
    if (available <= 0) return;
    const target = Math.max(0, (index + 0.5) * cell - available / 2);
    scrollRef.current?.scrollTo({ x: target, animated: true });
  }, [index, cell, available]);

  const underline = useAnimatedStyle(() => ({
    width: cell,
    transform: [{ translateX: pageWidth > 0 ? (scrollX.value / pageWidth) * cell : 0 }],
  }));

  return (
    <View style={styles.root} testID="deck-strip">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shelfOpen ? "Close the shelf" : "Show all games"}
        onPress={onOpenShelf}
        testID="deck-shelf-key"
        style={({ pressed }) => [styles.shelfKey, pressed && styles.shelfKeyPressed]}
      >
        <BrandIcon size={28} />
      </Pressable>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.cells}
        contentContainerStyle={styles.cellsContent}
        onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}
      >
        <Animated.View style={[styles.underline, underline]} />
        {games.map((mg, i) => (
          <Pressable
            key={mg.gameId}
            accessibilityRole="tab"
            accessibilityLabel={mg.game.title}
            accessibilityState={{ selected: i === index }}
            onPress={() => onSelect(i)}
            testID={`deck-strip-cell-${mg.gameId}`}
            style={[styles.cell, { width: cell }]}
          >
            <View style={i === index ? styles.glyphActive : styles.glyph}>
              <CartridgeLabel
                title={mg.game.title}
                mark={monograms.get(mg.game.title)}
                size={28}
                active={i === index}
              />
            </View>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel="Add a game"
          accessibilityState={{ selected: index === games.length }}
          onPress={() => onSelect(games.length)}
          testID="deck-strip-cell-slot"
          style={[styles.cell, { width: cell }]}
        >
          <View style={index === games.length ? styles.glyphActive : styles.glyph}>
            <PixelIcon
              name="plus"
              size={24}
              color={index === games.length ? tokens.neon.pink : tokens.text.secondary}
            />
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "stretch",
    height: deck.stripHeight,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  shelfKey: {
    width: deck.gutter,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  shelfKeyPressed: { backgroundColor: tokens.bg.elevated },
  cells: { flex: 1 },
  cellsContent: { alignItems: "stretch" },
  cell: { alignItems: "center", justifyContent: "center" },
  glyph: { opacity: 0.5 },
  glyphActive: { opacity: 1 },
  underline: {
    position: "absolute",
    pointerEvents: "none",
    left: 0,
    bottom: 0,
    height: tokens.bezel,
    backgroundColor: tokens.neon.pink,
    ...glow(tokens.neon.pinkGlow, 8),
  },
});
