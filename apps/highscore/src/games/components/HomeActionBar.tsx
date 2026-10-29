// Bottom action bar on the Games home: the two writes, always one thumb away.
//
// Three candidate treatments live here while the owner picks one (web
// `?bar=dock|composer|rail`; native takes the default). All three are built on
// today's `@workshop/ui` tokens and the idioms already on screen: the card's
// amber-muted "Play" pill, the DayRail's selected chip, the per-game board's
// paste composer. Labels are sentence case, as everything else in the app.
//
// - dock:     a floating pill that the cards scroll under. Elevated surface,
//             neutral drop shadow, "Add game" quiet on the left, "Paste score"
//             in the card's Play-pill language on the right.
// - composer: a message-composer row. Round "+" on the left, a field-shaped
//             "Paste today's score" pill on the right (the same filter-pill
//             shape the app already uses), on a hairline-topped canvas footer.
// - rail:     one segmented pill split in two, the paste cell filled the way the
//             DayRail marks the selected day. Sits in flow on the canvas, no
//             top rule: the rail at the top picks the day, the rail at the
//             bottom does the writes.

import { haptics, homeLayout, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { actionBarBottomPadding } from "../lib/actionBar";

export type HomeActionBarVariant = "dock" | "composer" | "rail";

export const HOME_ACTION_BAR_VARIANTS: readonly HomeActionBarVariant[] = [
  "dock",
  "composer",
  "rail",
];

export const DEFAULT_HOME_ACTION_BAR_VARIANT: HomeActionBarVariant = "dock";

const VARIANT_STORAGE_KEY = "hs.home-action-bar";

function isVariant(value: unknown): value is HomeActionBarVariant {
  return HOME_ACTION_BAR_VARIANTS.some((v) => v === value);
}

/**
 * Exploration only: resolve the bar treatment from `?bar=` (web), remembering
 * the last explicit choice in localStorage so it survives the in-app
 * navigations that drop the query (posting a score replaces to `/`). Native
 * has no query and no localStorage, so it always takes the default.
 */
export function resolveHomeActionBarVariant(param: string | undefined): HomeActionBarVariant {
  const store = typeof localStorage === "undefined" ? null : localStorage;
  if (isVariant(param)) {
    store?.setItem(VARIANT_STORAGE_KEY, param);
    return param;
  }
  const stored = store?.getItem(VARIANT_STORAGE_KEY);
  return isVariant(stored) ? stored : DEFAULT_HOME_ACTION_BAR_VARIANT;
}

/** Dock pill height; the card list pads its tail by this plus the float gap. */
const DOCK_HEIGHT = 56;
const DOCK_GAP = tokens.space.md;

/** How much tail room the card list needs so the last card clears the bar. */
export function homeActionBarListInset(variant: HomeActionBarVariant, insetBottom: number) {
  if (variant !== "dock") return 0;
  return DOCK_HEIGHT + DOCK_GAP + actionBarBottomPadding(insetBottom, tokens.space.md);
}

export interface HomeActionBarProps {
  variant: HomeActionBarVariant;
  insetBottom: number;
  onAddGame: () => void;
  onPasteScore: () => void;
}

export function HomeActionBar({
  variant,
  insetBottom,
  onAddGame,
  onPasteScore,
}: HomeActionBarProps) {
  const add = () => {
    haptics.light();
    onAddGame();
  };
  const paste = () => {
    haptics.light();
    onPasteScore();
  };
  const bottom = actionBarBottomPadding(insetBottom, tokens.space.md);

  if (variant === "dock") {
    return (
      <View style={[styles.dockWrap, { bottom }]} pointerEvents="box-none" testID="home-action-bar">
        <View style={styles.dock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a game"
            onPress={add}
            testID="fab-add-game"
            style={({ pressed, hovered }: PressState) => [
              styles.dockCell,
              (pressed || hovered) && styles.dockCellHover,
            ]}
          >
            <Text style={styles.dockPlus}>+</Text>
            <Text style={styles.dockQuietLabel}>Add game</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Paste a score"
            onPress={paste}
            testID="home-paste-score"
            style={({ pressed, hovered }: PressState) => [
              styles.dockCell,
              styles.dockPaste,
              (pressed || hovered) && styles.dockPasteHover,
            ]}
          >
            <ClipboardGlyph color={tokens.accent.default} />
            <Text style={styles.dockPasteLabel}>Paste score</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (variant === "composer") {
    return (
      <View style={[styles.composer, { paddingBottom: bottom }]} testID="home-action-bar">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a game"
          onPress={add}
          testID="fab-add-game"
          hitSlop={6}
          style={({ pressed, hovered }: PressState) => [
            styles.composerAdd,
            (pressed || hovered) && styles.composerAddHover,
          ]}
        >
          <Text style={styles.composerPlus}>+</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste a score"
          onPress={paste}
          testID="home-paste-score"
          style={({ pressed, hovered }: PressState) => [
            styles.composerField,
            (pressed || hovered) && styles.composerFieldHover,
          ]}
        >
          <ClipboardGlyph color={tokens.accent.default} />
          <Text style={styles.composerPlaceholder} numberOfLines={1}>
            Paste today's score
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.railWrap, { paddingBottom: bottom }]} testID="home-action-bar">
      <View style={styles.rail}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a game"
          onPress={add}
          testID="fab-add-game"
          style={({ pressed, hovered }: PressState) => [
            styles.railCell,
            (pressed || hovered) && styles.railCellHover,
          ]}
        >
          <Text style={styles.railPlus}>+</Text>
          <Text style={styles.railQuietLabel}>Add game</Text>
        </Pressable>
        <View style={styles.railDivider} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste a score"
          onPress={paste}
          testID="home-paste-score"
          style={({ pressed, hovered }: PressState) => [
            styles.railCell,
            styles.railPaste,
            (pressed || hovered) && styles.railPasteHover,
          ]}
        >
          <ClipboardGlyph color={tokens.accent.default} />
          <Text style={styles.railPasteLabel}>Paste score</Text>
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
  const boardW = size * 0.7;
  const boardH = size * 0.88;
  const tabW = size * 0.36;
  const tabH = size * 0.22;
  return (
    <View
      style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <View
        style={{
          width: boardW,
          height: boardH,
          borderWidth: stroke,
          borderColor: color,
          borderRadius: Math.max(2, size * 0.14),
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          width: tabW,
          height: tabH,
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
  // ---- dock ---------------------------------------------------------------
  dockWrap: {
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
    // Neutral lift, never an accent halo (DESIGN.md "FAB").
    boxShadow: "0px 12px 28px rgba(0, 0, 0, 0.45), 0px 2px 6px rgba(0, 0, 0, 0.30)",
    elevation: 6,
  },
  dockCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    borderRadius: tokens.radius.pill,
  },
  dockCellHover: { backgroundColor: tokens.bg.surface },
  dockPlus: {
    color: tokens.text.secondary,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: tokens.font.weight.medium,
    marginTop: -1,
  },
  dockQuietLabel: { ...LABEL, color: tokens.text.secondary },
  dockPaste: { flex: 1.35, backgroundColor: tokens.accent.muted },
  dockPasteHover: { backgroundColor: `${tokens.accent.default}33` },
  dockPasteLabel: { ...LABEL, color: tokens.accent.default },

  // ---- composer -----------------------------------------------------------
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
    backgroundColor: tokens.bg.canvas,
  },
  composerAdd: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  composerAddHover: { backgroundColor: tokens.bg.elevated },
  composerPlus: {
    color: tokens.text.primary,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: tokens.font.weight.medium,
    marginTop: -1,
  },
  composerField: {
    flex: 1,
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  composerFieldHover: { backgroundColor: tokens.bg.elevated },
  composerPlaceholder: {
    flex: 1,
    color: tokens.text.secondary,
    fontSize: tokens.font.size.md,
    lineHeight: 22,
  },

  // ---- rail ---------------------------------------------------------------
  railWrap: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
  },
  rail: {
    flexDirection: "row",
    height: 48,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    overflow: "hidden",
  },
  railCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
  },
  railCellHover: { backgroundColor: tokens.bg.elevated },
  railDivider: { width: StyleSheet.hairlineWidth, backgroundColor: tokens.border.default },
  railPlus: {
    color: tokens.text.secondary,
    fontSize: 22,
    lineHeight: 24,
    fontWeight: tokens.font.weight.medium,
    marginTop: -1,
  },
  railQuietLabel: { ...LABEL, color: tokens.text.secondary },
  railPaste: { flex: 1.35, backgroundColor: tokens.accent.muted },
  railPasteHover: { backgroundColor: `${tokens.accent.default}33` },
  railPasteLabel: { ...LABEL, color: tokens.accent.default },
});
