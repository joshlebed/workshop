// One-time "post scores from the share sheet" announcement on Games home:
// a pitch, a CTA into the /share-setup walkthrough, and an X that dismisses
// it for good. Same shape as AppUpdateBanner; visibility is
// useShareAnnouncement (iOS, 1.2.0+ binary, not dismissed/completed/adopted).

import { type Href, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useShareAnnouncement } from "../../hooks/useShareAnnouncement";
import { Button, IconButton, PixelIcon, Text, tokens } from "../../theme";

export function ShareAnnouncementCard() {
  const router = useRouter();
  const { visible, dismiss } = useShareAnnouncement();
  if (!visible) return null;
  return (
    <View style={styles.card} testID="share-announcement" accessibilityRole="summary">
      <View style={styles.copy}>
        <Text variant="label">Post from the Share button</Text>
        <Text variant="caption" tone="secondary">
          Add HighScore to your share sheet once. Then it's Share → HighScore → Post.
        </Text>
      </View>
      <Button
        label="Set up"
        onPress={() => router.push("/share-setup" as Href)}
        testID="share-announcement-cta"
      />
      <IconButton
        accessibilityLabel="Dismiss announcement"
        onPress={dismiss}
        testID="share-announcement-dismiss"
      >
        <PixelIcon name="close" size={16} color={tokens.text.secondary} />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginHorizontal: tokens.space.lg,
    marginBottom: tokens.space.sm,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.accent.default,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
});
