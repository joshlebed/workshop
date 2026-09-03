// Today's recap — the thing you actually leave the app to do. It used to be an
// icon in the header, which is the worst place for the day's one shareable
// artefact: invisible until you already know it exists. Now it's the last block
// of both projections, showing the real text that lands on the clipboard.
//
// It only appears once you've posted something. There is nothing to recap
// before that, and an empty "share your scores" card is a nag.

import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, Text, tokens } from "../../../theme";

interface RecapCardProps {
  /** The composed recap, minus the play link (which is minted on copy). */
  preview: string;
  copying: boolean;
  onCopy: () => void;
}

export function RecapCard({ preview, copying, onCopy }: RecapCardProps) {
  return (
    <View style={styles.card} testID="recap-card">
      <View style={styles.head}>
        <Text variant="eyebrow" tone="secondary" style={styles.title}>
          Recap
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy today's scores to the clipboard"
          onPress={onCopy}
          disabled={copying}
          testID="recap-copy"
          style={({ pressed }) => [styles.copy, pressed && styles.copyPressed]}
        >
          {copying ? (
            <ActivityIndicator size="small" color={tokens.neon.pink} />
          ) : (
            <>
              <PixelIcon name="copy" size={16} color={tokens.neon.pink} />
              <Text variant="cell" style={styles.copyLabel}>
                Copy
              </Text>
            </>
          )}
        </Pressable>
      </View>
      <Text variant="mono" tone="secondary" style={styles.preview}>
        {preview}
      </Text>
      <Text variant="caption" tone="secondary">
        Copying adds a link that invites whoever reads it to play.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    padding: tokens.space.sm,
    gap: tokens.space.sm,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { letterSpacing: 1 },
  copy: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: 28,
    paddingHorizontal: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  copyPressed: { backgroundColor: tokens.accent.muted },
  copyLabel: { color: tokens.neon.pinkTint, letterSpacing: 0 },
  preview: { color: tokens.text.secondary },
});
