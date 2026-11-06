// The Games home's one write: a round pink "+" floating bottom-right. It opens
// the post screen (`/share`), where you paste a score and, from the top of
// "Your games", add more games. The card list pads its tail by
// `homeActionBarListInset` so the last card clears the button.

import { haptics } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { homeLayout, PixelIcon, tokens } from "../../theme";
import { actionBarBottomPadding } from "../lib/actionBar";

const FAB_SIZE = 60;
const FAB_GAP = tokens.space.md;

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
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.fab,
          (pressed || hovered) && styles.fabPressed,
        ]}
      >
        <PixelIcon name="plus" size={32} color={tokens.text.onAccent} />
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
  // Filled pink with a dark glyph (DESIGN.md: dark-on-neon reads as a lit
  // sign), plus the pink glow reserved for primary elements.
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.neon.pink,
    shadowColor: tokens.neon.pink,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  fabPressed: { backgroundColor: tokens.accent.hover },
});
