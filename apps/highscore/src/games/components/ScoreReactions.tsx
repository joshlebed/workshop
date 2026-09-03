// Emoji reaction chips for one score (G2c). Pure presentation: the reactions
// arrive aggregated from the server (one chip per emoji, with a count and a
// `viewerReacted` flag). Tapping a chip toggles the viewer's own reaction to
// that emoji; the trailing add affordance opens the full picker. Both callbacks
// are optional — omit them (self row, past-day read-only) and the chips render
// inert with no add button.

import type { ScoreReactionSummary } from "@workshop/shared/games";
import { Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, Text, tokens } from "../../theme";

export interface ScoreReactionsProps {
  reactions: ScoreReactionSummary[];
  /** Tap an existing chip — caller decides set-vs-remove from `currentlyReacted`. */
  onToggle?: (emoji: string, currentlyReacted: boolean) => void;
  /** Open the picker. Omit to hide the add affordance entirely. */
  onAdd?: () => void;
  testIDPrefix?: string;
}

export function ScoreReactions({ reactions, onToggle, onAdd, testIDPrefix }: ScoreReactionsProps) {
  if (reactions.length === 0 && !onAdd) return null;
  return (
    <View style={styles.row}>
      {reactions.map((r) => (
        <Pressable
          key={r.emoji}
          disabled={!onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${r.emoji}, ${r.count}${r.viewerReacted ? ", you reacted" : ""}`}
          onPress={() => onToggle?.(r.emoji, r.viewerReacted)}
          testID={testIDPrefix ? `${testIDPrefix}-chip-${r.emoji}` : undefined}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.chip,
            r.viewerReacted && styles.chipActive,
            onToggle && (pressed || hovered) && styles.chipHover,
          ]}
        >
          <Text style={styles.chipEmoji}>{r.emoji}</Text>
          {r.count > 1 ? (
            <Text style={[styles.chipCount, r.viewerReacted && styles.chipCountActive]}>
              {r.count}
            </Text>
          ) : null}
        </Pressable>
      ))}
      {onAdd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a reaction"
          onPress={onAdd}
          hitSlop={6}
          testID={testIDPrefix ? `${testIDPrefix}-add` : undefined}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.addBtn,
            (pressed || hovered) && styles.chipHover,
          ]}
        >
          <PixelIcon name="plus" size={16} color={tokens.border.default} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.space.xs,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.elevated,
  },
  chipActive: {
    borderColor: tokens.accent.default,
    backgroundColor: tokens.accent.muted,
  },
  chipHover: { backgroundColor: tokens.bg.raised },
  chipEmoji: { fontSize: 13, lineHeight: 18 },
  chipCount: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.text.secondary,
    fontVariant: ["tabular-nums"],
  },
  chipCountActive: { color: tokens.accent.default },
  // No frame on the add affordance — it appears on every friend's row, and a
  // boxed version turns the board into a grid of identical chips.
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
});
