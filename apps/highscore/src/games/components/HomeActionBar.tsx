// Bottom action bar on the Games home: the two writes, always one thumb away.
//
// A floating bar the cards scroll under (UX-DECISIONS entry 4): a bezelled
// dark dock, "Add game" quiet on the left, "Paste score" lit in pink on the
// right — neon border + neon label, no solid fill, no soft shadow (DESIGN.md).
// Labels are sentence case, like everything else in the app. The card list
// pads its tail by `homeActionBarListInset` so the last card clears the bar.

import { haptics } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { bodyType, homeLayout, PixelIcon, Text, tokens } from "../../theme";
import { actionBarBottomPadding } from "../lib/actionBar";

const DOCK_HEIGHT = 56;
const DOCK_GAP = tokens.space.md;

/** Tail room the card list needs so the last card clears the floating bar. */
export function homeActionBarListInset(insetBottom: number): number {
  return DOCK_HEIGHT + DOCK_GAP + actionBarBottomPadding(insetBottom, tokens.space.md);
}

export interface HomeActionBarProps {
  insetBottom: number;
  onAddGame: () => void;
  onPasteScore: () => void;
}

export function HomeActionBar({ insetBottom, onAddGame, onPasteScore }: HomeActionBarProps) {
  const add = () => {
    haptics.light();
    onAddGame();
  };
  const paste = () => {
    haptics.light();
    onPasteScore();
  };
  const bottom = actionBarBottomPadding(insetBottom, tokens.space.md);

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none" testID="home-action-bar">
      <View style={styles.dock}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a game"
          onPress={add}
          testID="fab-add-game"
          style={({ pressed, hovered }: PressState) => [
            styles.cell,
            (pressed || hovered) && styles.cellHover,
          ]}
        >
          <PixelIcon name="plus" size={16} color={tokens.text.secondary} />
          <Text style={styles.quietLabel}>Add game</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste a score"
          onPress={paste}
          testID="home-paste-score"
          style={({ pressed, hovered }: PressState) => [
            styles.cell,
            styles.paste,
            (pressed || hovered) && styles.pasteHover,
          ]}
        >
          <PixelIcon name="copy" size={16} color={tokens.neon.pink} />
          <Text style={styles.pasteLabel}>Paste score</Text>
        </Pressable>
      </View>
    </View>
  );
}

type PressState = { pressed: boolean; hovered?: boolean };

const LABEL = {
  ...bodyType("semibold"),
  fontSize: 15,
  lineHeight: 20,
} as const;

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: homeLayout.horizontalInset,
    right: homeLayout.horizontalInset,
  },
  dock: {
    flexDirection: "row",
    height: DOCK_HEIGHT,
    padding: 6,
    gap: 6,
    borderRadius: 0,
    backgroundColor: tokens.bg.surface,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  cell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    borderColor: "transparent",
  },
  cellHover: { backgroundColor: tokens.bg.elevated },
  quietLabel: { ...LABEL, color: tokens.text.secondary },
  paste: { flex: 1.35, borderColor: tokens.neon.pink },
  pasteHover: { backgroundColor: tokens.accent.muted },
  pasteLabel: { ...LABEL, color: tokens.neon.pink },
});
