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
import { homeLayout } from "@workshop/ui";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from "react-native";
import { HsButton, HsText, hs, hsBezel } from "../../../theme";
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
        <ActivityIndicator color={hs.color.primary} />
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
          <HsText variant="heading">Add friends to compare scores</HsText>
          <HsText tone="secondary" style={styles.introBody}>
            Invite someone you play with. Their games and today's scores will show up here.
          </HsText>
        </View>
        <View style={styles.ctaStack}>
          {/* The one primary CTA on the empty home — everything else stays quiet. */}
          <HsButton
            label="Add friends"
            onPress={onAddFriends}
            loading={invitePending}
            testID="games-empty-add-friends"
          />
          <HsButton
            label="Add a game by URL"
            variant="ghost"
            onPress={onAddByUrl}
            testID="games-empty-add-url"
          />
        </View>
        {inviteUrl ? (
          <View style={styles.inviteBlock}>
            <HsText variant="caption" tone="secondary" style={styles.inviteHint}>
              {Platform.OS === "web"
                ? "Send this link. Whoever opens it and taps Accept becomes your friend."
                : "Share this link. Whoever opens it and taps Accept becomes your friend."}
            </HsText>
            <View style={styles.inviteUrlRow}>
              <View style={styles.inviteUrlField}>
                <HsText
                  variant="caption"
                  tone="secondary"
                  numberOfLines={1}
                  testID="games-empty-invite-url"
                >
                  {inviteUrl}
                </HsText>
              </View>
              <HsButton
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
        <HsText variant="heading">Pick a first game</HsText>
        <HsText tone="secondary" style={styles.introBody}>
          Add one your friends already play, or paste a game URL.
        </HsText>
      </View>

      {discoveryLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={hs.color.primary} />
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
        <HsText tone="secondary" style={styles.emptyHint} testID="games-empty-no-suggestions">
          Your friends haven't added any games yet. Add one by URL and they'll see it too.
        </HsText>
      )}

      <HsButton
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
    padding: hs.space.lg,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: hs.space.xxl,
    paddingBottom: homeLayout.bottomInset,
    gap: hs.space.lg,
  },
  intro: { gap: hs.space.sm, maxWidth: 420 },
  introBody: { maxWidth: 420, lineHeight: 22 },
  ctaStack: { gap: hs.space.sm, width: "100%", maxWidth: 420 },
  emptyHint: { maxWidth: 420 },
  inviteBlock: { gap: hs.space.sm, width: "100%", maxWidth: 420 },
  inviteHint: { maxWidth: 420 },
  inviteUrlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hs.space.sm,
  },
  inviteUrlField: {
    ...hsBezel,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: hs.space.md,
    paddingVertical: hs.space.sm,
    backgroundColor: hs.color.surface2,
  },
});
