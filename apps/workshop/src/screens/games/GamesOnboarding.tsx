// Games-home empty state (G3, issue #293) — friends-first onboarding. Two
// variants depending on whether the viewer has any friends yet:
//
//   • No friends   → pitch "Add friends" (mints + shares an invite link via the
//                     G2b machinery), with "Add a game by URL" as the skip /
//                     bootstrap path for the very first user.
//   • Has friends  → their games as one-tap suggestions (you likely just
//                     accepted an invite and have nothing on your home yet).
//
// All data + mutations live in GamesHome; this component is presentational.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Button, Text, tokens } from "../../ui/index";
import { FriendGameSuggestions } from "./FriendGameSuggestions";

interface GamesOnboardingProps {
  friendsLoading: boolean;
  hasFriends: boolean;
  discovery: DiscoveryGame[];
  discoveryLoading: boolean;
  invitePending: boolean;
  inviteUrl: string | null;
  onAddFriends: () => void;
  onCopyInvite: () => void;
  onAddByUrl: () => void;
  onAddDiscovery: (game: DiscoveryGame) => void;
  addingGameIds: string[];
  addedGameIds: string[];
}

export function GamesOnboarding({
  friendsLoading,
  hasFriends,
  discovery,
  discoveryLoading,
  invitePending,
  inviteUrl,
  onAddFriends,
  onCopyInvite,
  onAddByUrl,
  onAddDiscovery,
  addingGameIds,
  addedGameIds,
}: GamesOnboardingProps) {
  // Resolve which variant to show first — flashing the no-friends pitch and
  // then swapping to suggestions reads as a glitch.
  if (friendsLoading) {
    return (
      <View style={styles.center} testID="games-onboarding">
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (!hasFriends) {
    return (
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        testID="games-onboarding"
      >
        <View style={styles.hero}>
          <Text style={styles.heroGlyph}>🎮</Text>
          <Text variant="title" style={styles.heroTitle}>
            Better with friends
          </Text>
          <Text tone="secondary" style={styles.heroBody}>
            Games show up here once you add a friend — you'll see what they play and how today's
            scores stack up.
          </Text>
        </View>
        <View style={styles.ctaStack}>
          <Button
            label="Add friends"
            onPress={onAddFriends}
            loading={invitePending}
            testID="games-empty-add-friends"
          />
          <Button
            label="Add a game by URL"
            variant="ghost"
            onPress={onAddByUrl}
            testID="games-empty-add-url"
          />
        </View>
        {inviteUrl ? (
          <View style={styles.inviteBlock}>
            <Text variant="caption" tone="muted" style={styles.inviteHint}>
              {Platform.OS === "web"
                ? "Send this link — whoever opens it and taps Accept becomes your friend."
                : "Share this link — whoever opens it and taps Accept becomes your friend."}
            </Text>
            <View style={styles.inviteUrlRow}>
              <View style={styles.inviteUrlField}>
                <Text
                  variant="caption"
                  tone="secondary"
                  numberOfLines={1}
                  testID="games-empty-invite-url"
                >
                  {inviteUrl}
                </Text>
              </View>
              <Button
                label="Copy"
                variant="secondary"
                size="md"
                onPress={onCopyInvite}
                testID="games-empty-invite-copy"
              />
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  // Has friends — surface their games as one-tap suggestions.
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      testID="games-onboarding"
    >
      <View style={styles.hero}>
        <Text variant="title" style={styles.heroTitle}>
          Add games your friends play
        </Text>
        <Text tone="secondary" style={styles.heroBody}>
          One tap adds a game to your home so you can compare daily scores.
        </Text>
      </View>

      {discoveryLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : discovery.length > 0 ? (
        <FriendGameSuggestions
          games={discovery}
          addingGameIds={addingGameIds}
          addedGameIds={addedGameIds}
          onAdd={onAddDiscovery}
          testIDPrefix="games-empty-suggestion"
        />
      ) : (
        <Text tone="secondary" style={styles.emptyHint} testID="games-empty-no-suggestions">
          Your friends haven't added any games yet. Add one by URL and they'll see it too.
        </Text>
      )}

      <Button
        label="Add a game by URL"
        variant="ghost"
        onPress={onAddByUrl}
        testID="games-empty-add-url"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.space.lg,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  hero: { alignItems: "center", gap: tokens.space.sm },
  heroGlyph: { fontSize: 44, lineHeight: 52 },
  heroTitle: { textAlign: "center" },
  heroBody: { textAlign: "center", maxWidth: 360 },
  ctaStack: { gap: tokens.space.sm },
  emptyHint: { textAlign: "center" },
  inviteBlock: { gap: tokens.space.sm },
  inviteHint: { textAlign: "center" },
  inviteUrlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  inviteUrlField: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.canvas,
  },
});
