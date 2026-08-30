// Emoji reaction chips for one score (G2c). Pure presentation: the reactions
// arrive aggregated from the server (one chip per emoji, with a count and a
// `viewerReacted` flag). Tapping a chip toggles the viewer's own reaction to
// that emoji; the trailing add affordance opens the full picker. Both callbacks
// are optional — omit them (self row, past-day read-only) and the chips render
// inert with no add button.

import type { ScoreReactionSummary } from "@workshop/shared/games";
import { Pressable, StyleSheet, View } from "react-native";
import { HsText, hsColor, hsSpace } from "../../theme";

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
          <HsText style={styles.chipEmoji}>{r.emoji}</HsText>
          {r.count > 1 ? (
            <HsText style={[styles.chipCount, r.viewerReacted && styles.chipCountActive]}>
              {r.count}
            </HsText>
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
          <HsText style={styles.addFace}>🙂</HsText>
          <HsText style={styles.addPlus}>+</HsText>
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
    gap: hsSpace.xs,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: hsColor.border,
    backgroundColor: hsColor.surface2,
  },
  // Your own reaction = selection → pink bezel.
  chipActive: {
    borderColor: hsColor.primary,
    backgroundColor: `${hsColor.primary}1F`,
  },
  chipHover: { backgroundColor: hsColor.surface3 },
  chipEmoji: { fontSize: 13, lineHeight: 18 },
  chipCount: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    color: hsColor.textSecondary,
    fontVariant: ["tabular-nums"],
  },
  chipCountActive: { color: hsColor.primaryTint },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: hsColor.border,
  },
  addFace: { fontSize: 12, lineHeight: 16, opacity: 0.7 },
  addPlus: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    color: hsColor.textSecondary,
    marginLeft: 1,
  },
});
