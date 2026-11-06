// The Games home's one write: a round pink "+" floating bottom-right. It opens
// the post screen (`/share`), where you paste a score and, from the top of
// "Your games", add more games. The card list pads its tail by
// `homeActionBarListInset` so the last card clears the button.

import { haptics } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { homeLayout, tokens } from "../../theme";
import { actionBarBottomPadding } from "../lib/actionBar";

// The button is drawn on a 4px pixel grid (15×15 cells = 60px): a stair-
// stepped disc and a chunky plus, both plain Views — no SVG (see DESIGN.md
// "Iconography": pixel art drawn from Views keeps the runtime OTA-safe).
const PX = 4;
const CELLS = 15;
const FAB_SIZE = PX * CELLS;
const FAB_GAP = tokens.space.md;
/** Cells filled on each row of the disc (odd, so every row centres on the grid). */
const DISC_ROWS: { id: string; cells: number }[] = Array.from({ length: CELLS }, (_, i) => {
  const r = CELLS / 2;
  const y = i + 0.5 - r;
  const w = 2 * Math.sqrt(Math.max(0, r * r - y * y));
  const odd = Math.round((w - 1) / 2) * 2 + 1;
  return { id: `row-${i}`, cells: Math.max(1, Math.min(CELLS, odd)) };
});
/** Plus: 3 cells thick, 9 cells long (12px × 36px bars). */
const PLUS_THICK = PX * 3;
const PLUS_LONG = PX * 9;

/** Tail room the card list needs so the last card clears the floating button. */
export function homeActionBarListInset(insetBottom: number): number {
  return FAB_SIZE + FAB_GAP + actionBarBottomPadding(insetBottom, tokens.space.md);
}

export interface HomeActionBarProps {
  insetBottom: number;
  onPress: () => void;
}

export function HomeActionBar({ insetBottom, onPress }: HomeActionBarProps) {
  const bottom = actionBarBottomPadding(insetBottom, tokens.space.md);
  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none" testID="home-action-bar">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Post a score or add a game"
        onPress={() => {
          haptics.light();
          onPress();
        }}
        testID="home-paste-score"
        style={styles.fab}
      >
        {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => {
          const fill = pressed || hovered ? tokens.accent.hover : tokens.neon.pink;
          return (
            <>
              <View style={styles.disc} pointerEvents="none">
                {DISC_ROWS.map((row) => (
                  <View
                    key={row.id}
                    style={[styles.discRow, { width: row.cells * PX, backgroundColor: fill }]}
                  />
                ))}
              </View>
              <View style={[styles.bar, styles.barH]} pointerEvents="none" />
              <View style={[styles.bar, styles.barV]} pointerEvents="none" />
            </>
          );
        }}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: homeLayout.horizontalInset,
  },
  // The one round control in the app, on purpose: it floats over the list.
  // Filled pink with a dark plus (DESIGN.md: dark-on-neon reads as a lit
  // sign), stepped like the rest of the pixel art.
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  disc: { ...StyleSheet.absoluteFillObject, alignItems: "center" },
  discRow: { height: PX },
  bar: { position: "absolute", backgroundColor: tokens.text.onAccent },
  barH: { width: PLUS_LONG, height: PLUS_THICK },
  barV: { width: PLUS_THICK, height: PLUS_LONG },
});
