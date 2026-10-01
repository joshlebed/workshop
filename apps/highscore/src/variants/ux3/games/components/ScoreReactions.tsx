// Emoji reaction chips for one score (G2c). Pure presentation: the reactions
// arrive aggregated from the server (one chip per emoji, with a count and a
// `viewerReacted` flag). Tapping a chip toggles the viewer's own reaction to
// that emoji; the trailing add affordance opens the full picker. Both callbacks
// are optional — omit them (self row, past-day read-only) and the chips render
// inert with no add button.
//
// Restyled onto HighScore tokens: sharp 2px-bezel squares, count in the pixel
// face so it aligns with the score column beside it. The add affordance is a
// bare `+` square that only appears on rows you can react to.

import type { ScoreReactionSummary } from "@workshop/shared/games";
import { Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, Text, tokens } from "../../theme";

export interface ScoreReactionsProps {
  reactions: ScoreReactionSummary[];
  /** Tap an existing chip — caller decides set-vs-remove from `currentlyReacted`. */
  onToggle?: (emoji: string, currentlyReacted: boolean) => void;
  /** Open the picker. Omit to hide the add affordance entirely. */
  onAdd?: () => void;
  /**
   * Label for the add affordance. The board sheet spells the verb out — it's
   * the surface where the gesture gets taught; the feed omits `onAdd` entirely
   * and makes the whole score line the target instead.
   */
  addLabel?: string;
  testIDPrefix?: string;
}

export function ScoreReactions({
  reactions,
  onToggle,
  onAdd,
  addLabel,
  testIDPrefix,
}: ScoreReactionsProps) {
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
            <Text variant="eyebrow" tone={r.viewerReacted ? "link" : "secondary"}>
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
          {addLabel ? (
            <Text variant="eyebrow" tone="secondary">
              {addLabel}
            </Text>
          ) : (
            <PixelIcon name="plus" size={16} color={tokens.text.secondary} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs, flexWrap: "wrap" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 24,
    paddingHorizontal: 5,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: "transparent",
  },
  chipActive: { borderColor: tokens.neon.pink },
  chipHover: { backgroundColor: tokens.bg.raised },
  chipEmoji: { fontSize: 12, lineHeight: 16 },
  // Bare glyph, no bezel: one of these sits on every friend's score line, and
  // a column of identical bordered boxes down the right edge of the feed reads
  // as chrome rather than an invitation.
  addBtn: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: tokens.space.xs,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.7,
  },
});
