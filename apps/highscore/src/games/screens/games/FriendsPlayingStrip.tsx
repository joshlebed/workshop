// "Friends are playing" — the discovery nudge at the foot of the Games home
// card list. Games your friends play that you haven't added, top few as
// one-tap adds, with "See all" opening the full add-game sheet. Replaces the
// FAB as the home's always-visible way to grow My Games: present on every
// visit, never competing with the docked "Paste a score" action. Renders
// nothing when there is nothing to suggest.

import type { DiscoveryGame } from "@workshop/shared/games";
import { Button, Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import { FriendGameSuggestions } from "./FriendGameSuggestions";

const MAX_ROWS = 3;

interface FriendsPlayingStripProps {
  /** Discovery feed; owned games are filtered out here. */
  discovery: DiscoveryGame[];
  addingGameIds: string[];
  addedGameIds: string[];
  onAdd: (game: DiscoveryGame) => void;
  onSeeAll: () => void;
}

export function FriendsPlayingStrip({
  discovery,
  addingGameIds,
  addedGameIds,
  onAdd,
  onSeeAll,
}: FriendsPlayingStripProps) {
  // Keep a just-added game in place (it flips to "✓ Added") rather than
  // letting the next row jump up under the user's thumb.
  const unowned = discovery.filter((dg) => !dg.inMyGames || addedGameIds.includes(dg.game.id));
  if (unowned.length === 0) return null;
  const shown = unowned.slice(0, MAX_ROWS);
  const more = unowned.length - shown.length;

  return (
    <View style={styles.root} testID="friends-playing-strip">
      <View style={styles.header}>
        <Text variant="heading" style={styles.title}>
          Friends are playing
        </Text>
        <Text variant="caption" tone="muted">
          Add one to see their scores next to yours.
        </Text>
      </View>
      <FriendGameSuggestions
        games={shown}
        addingGameIds={addingGameIds}
        addedGameIds={addedGameIds}
        onAdd={onAdd}
        testIDPrefix="friends-playing"
      />
      <Button
        label={more > 0 ? `See all (${unowned.length})` : "Add a game by link"}
        variant="ghost"
        onPress={onSeeAll}
        testID="friends-playing-see-all"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginTop: tokens.space.xl,
    gap: tokens.space.md,
  },
  header: { gap: 2 },
  title: { fontSize: tokens.font.size.md },
});
