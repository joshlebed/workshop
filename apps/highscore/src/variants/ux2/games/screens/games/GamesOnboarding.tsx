// Games-home empty state (G3, issue #293) — friends-first onboarding. Two
// variants depending on whether the viewer has any friends yet:
//
//   • No friends   → pitch "Add friends" (mints + shares an invite link via the
//                     G2b machinery), with "Add a game by URL" as the skip /
//                     bootstrap path for the very first user.
//   • Has friends  → their games as one-tap suggestions (you likely just
//                     accepted an invite and have nothing on your home yet).
//
// All data + mutations live in the shell; this component is presentational.
// Inviting is the drawer's job now, so "Add friends" opens it rather than
// minting a second copy of the invite-link UI here.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { Button, homeLayout, pixelType, Text, tokens } from "../../../theme";
import { FriendGameSuggestions } from "./FriendGameSuggestions";

interface GamesOnboardingProps {
  friendsLoading: boolean;
  hasFriends: boolean;
  discovery: DiscoveryGame[];
  discoveryLoading: boolean;
  onAddFriends: () => void;
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
  onAddFriends,
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
          <Text style={styles.introTitle}>NOBODY TO BEAT YET</Text>
          <Text tone="secondary" style={styles.introBody}>
            HighScore is a scoreboard, so it needs someone on the other side of it. Add a person you
            already play with and their results land here every morning.
          </Text>
        </View>
        <View style={styles.ctaStack}>
          <Button label="Add friends" onPress={onAddFriends} testID="games-empty-add-friends" />
          <Button
            label="Add a game by URL"
            variant="ghost"
            onPress={onAddByUrl}
            testID="games-empty-add-url"
          />
        </View>
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
        <Text style={styles.introTitle}>PICK YOUR FIRST GAME</Text>
        <Text tone="secondary" style={styles.introBody}>
          Add one your friends already play. Their scores for it are already waiting.
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
  introTitle: { ...pixelType(14), color: tokens.text.primary },
  introBody: { maxWidth: 420, lineHeight: 22 },
  ctaStack: { gap: tokens.space.sm, width: "100%", maxWidth: 420 },
  emptyHint: { maxWidth: 420 },
});
