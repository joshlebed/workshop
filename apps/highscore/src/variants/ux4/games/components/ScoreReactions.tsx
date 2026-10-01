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
          style={({ pressed }) => [
            styles.chip,
            r.viewerReacted && styles.chipActive,
            onToggle && pressed && styles.chipPressed,
          ]}
        >
          <Text style={styles.chipEmoji}>{r.emoji}</Text>
          {r.count > 1 ? (
            <Text variant="cell" style={r.viewerReacted ? styles.countActive : styles.count}>
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
          style={({ pressed }) => [styles.addBtn, pressed && styles.chipPressed]}
        >
          <PixelIcon name="plus" size={12} color={tokens.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs, flexShrink: 0 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 22,
    paddingHorizontal: 5,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.elevated,
  },
  chipActive: { borderColor: tokens.neon.pink },
  chipPressed: { backgroundColor: tokens.bg.raised },
  chipEmoji: { fontSize: 12, lineHeight: 16 },
  count: { color: tokens.text.secondary, letterSpacing: 0 },
  countActive: { color: tokens.neon.pinkTint, letterSpacing: 0 },
  addBtn: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
});
