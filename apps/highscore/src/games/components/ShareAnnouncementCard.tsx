// One-time "post scores from the share sheet" announcement on the Games home.
// Visibility rules live in src/lib/shareOnboarding.ts (shouldShowShareAnnouncement);
// this component is purely presentational: a pitch, a CTA into the /share-setup
// walkthrough, and an X that dismisses forever (server-side flag, cross-device).

import { Button, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";

export function ShareAnnouncementCard({
  onShowMeHow,
  onDismiss,
}: {
  onShowMeHow: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.card} testID="share-announcement">
      <View style={styles.headerRow}>
        <Text style={styles.glyph}>⚡️</Text>
        <View style={styles.copy}>
          <Text variant="label">New: post scores from the share sheet</Text>
          <Text variant="caption" tone="secondary">
            Finish a game, tap Share, tap HighScore — your score posts itself. One-time setup, ~30
            seconds.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss announcement"
          onPress={onDismiss}
          testID="share-announcement-dismiss"
          hitSlop={10}
          style={({ pressed }) => [styles.dismiss, pressed && styles.dismissPressed]}
        >
          <Text style={styles.dismissGlyph}>x</Text>
        </Pressable>
      </View>
      <Button label="Show me how" size="md" onPress={onShowMeHow} testID="share-announcement-cta" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.accent.default,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.md,
  },
  glyph: { fontSize: tokens.font.size.xl, lineHeight: 28 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  dismiss: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  dismissPressed: { backgroundColor: tokens.bg.elevated },
  dismissGlyph: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
  },
});
