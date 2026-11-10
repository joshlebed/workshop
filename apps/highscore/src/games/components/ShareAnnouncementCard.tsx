// "Post scores from the share sheet" on Games home. Two jobs, one hook
// (useShareAnnouncement — iOS, 1.2.0+ binary, flags loaded):
//   1. Onboarding: the first time a signed-in account lands here with at
//      least one game and no share-setup history, push the /share-setup
//      walkthrough itself. Once per account (`onboardedAt`), only while this
//      screen is focused so it never fights a deep-link or share-intent
//      redirect. `hasGames` comes from the home's games query (undefined while
//      loading) — the empty home runs its own friends → games onboarding and
//      there is nothing to share from yet.
//   2. Reminder: the card below — a pitch, a CTA into the walkthrough, and an
//      X that dismisses it for good. It stays after a skipped onboarding.

import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useShareAnnouncement } from "../../hooks/useShareAnnouncement";
import { Button, IconButton, PixelIcon, Text, tokens } from "../../theme";

export function ShareAnnouncementCard({ hasGames }: { hasGames: boolean | undefined }) {
  const router = useRouter();
  const { visible, dismiss, autoOpen, markOnboarded } = useShareAnnouncement({ hasGames });
  // One push per mount even if the flags query refetches before the
  // optimistic `onboardedAt` lands.
  const openedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!autoOpen || openedRef.current) return;
      openedRef.current = true;
      markOnboarded();
      router.push("/share-setup?onboarding=1" as Href);
    }, [autoOpen, markOnboarded, router]),
  );
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
