// Bottom action bar on the Games home: the two writes, always one thumb away.
//
// A floating pill the cards scroll under (UX-DECISIONS entry 4). Built from
// the idioms already on screen: "Add game" sits quiet on the left, "Paste
// score" borrows the card's amber-muted Play-pill language on the right. The
// lift is a neutral drop shadow, never an accent halo (DESIGN.md "FAB").
// Labels are sentence case, like everything else in the app. The card list
// pads its tail by `homeActionBarListInset` so the last card clears the bar.

import { haptics, homeLayout, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
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
          <Text style={styles.plus}>+</Text>
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
          <ClipboardGlyph color={tokens.accent.default} />
          <Text style={styles.pasteLabel}>Paste score</Text>
        </Pressable>
      </View>
    </View>
  );
}

type PressState = { pressed: boolean; hovered?: boolean };

// A clipboard drawn from plain Views (no react-native-svg in the app): an
// outlined board with a solid clip tab riding its top edge.
function ClipboardGlyph({ color, size = 16 }: { color: string; size?: number }) {
  const stroke = 1.5;
  return (
    <View
      style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <View
        style={{
          width: size * 0.7,
          height: size * 0.88,
          borderWidth: stroke,
          borderColor: color,
          borderRadius: Math.max(2, size * 0.14),
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          width: size * 0.36,
          height: size * 0.22,
          borderRadius: Math.max(1.5, size * 0.1),
          backgroundColor: color,
        }}
      />
    </View>
  );
}

const LABEL = {
  fontSize: 15,
  lineHeight: 20,
  fontWeight: tokens.font.weight.semibold,
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
    borderRadius: DOCK_HEIGHT / 2,
    backgroundColor: tokens.bg.elevated,
    borderWidth: 1,
    borderColor: tokens.border.default,
    boxShadow: "0px 12px 28px rgba(0, 0, 0, 0.45), 0px 2px 6px rgba(0, 0, 0, 0.30)",
    elevation: 6,
  },
  cell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    borderRadius: tokens.radius.pill,
  },
  cellHover: { backgroundColor: tokens.bg.surface },
  plus: {
    color: tokens.text.secondary,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: tokens.font.weight.medium,
    marginTop: -1,
  },
  quietLabel: { ...LABEL, color: tokens.text.secondary },
  paste: { flex: 1.35, backgroundColor: tokens.accent.muted },
  pasteHover: { backgroundColor: `${tokens.accent.default}33` },
  pasteLabel: { ...LABEL, color: tokens.accent.default },
});
