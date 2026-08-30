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
import { Button, homeLayout, Text, tokens } from "../../../theme";
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
        <ActivityIndicator color={tokens.neon.pink} />
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
        <View style={styles.intro}>
          <Text variant="heading" style={styles.introTitle}>
            Add friends to compare scores
          </Text>
          <Text tone="secondary" style={styles.introBody}>
            Invite someone you play with. Their games and today's scores will show up here.
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
                ? "Send this link. Whoever opens it and taps Accept becomes your friend."
                : "Share this link. Whoever opens it and taps Accept becomes your friend."}
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
      <View style={styles.intro}>
        <Text variant="heading" style={styles.introTitle}>
          Pick a first game
        </Text>
        <Text tone="secondary" style={styles.introBody}>
          Add one your friends already play, or paste a game URL.
        </Text>
      </View>

      {discoveryLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.neon.pink} />
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
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.xxl,
    paddingBottom: homeLayout.bottomInset,
    gap: tokens.space.lg,
  },
  intro: { gap: tokens.space.sm, maxWidth: 420 },
  // Pixel heading, one step up from the card headings for the hero moment.
  introTitle: { fontSize: 16, lineHeight: 26 },
  introBody: { maxWidth: 420, lineHeight: 22 },
  ctaStack: { gap: tokens.space.sm, width: "100%", maxWidth: 420 },
  emptyHint: { maxWidth: 420 },
  inviteBlock: { gap: tokens.space.sm, width: "100%", maxWidth: 420 },
  inviteHint: { maxWidth: 420 },
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
    borderRadius: 0,
    borderWidth: 1,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
});
