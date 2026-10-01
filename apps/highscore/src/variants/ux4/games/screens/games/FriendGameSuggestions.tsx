// Friend-game discovery list (G3, issue #293) — a presentational column of
// "games your friends play that you haven't added", each one-tap addable.
// Shared by three surfaces: the + add-game sheet (suggestions above the URL
// field), the Games-home "friends but no games" empty state, and the
// post-accept picker. Data + add mutations live at the call site; this file
// only renders rows and reports taps.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, Text, tokens } from "../../../theme";
import { GameCover } from "../../components/GameCover";

/** "Sam plays" / "Sam & Alex play" / "Sam, Alex +2 play". */
function friendsPlayLine(friends: DiscoveryGame["friends"]): string {
  const names = friends.map((f) => f.displayName?.trim() || "Someone");
  if (names.length === 0) return "A friend plays this";
  if (names.length === 1) return `${names[0]} plays`;
  if (names.length === 2) return `${names[0]} & ${names[1]} play`;
  return `${names[0]}, ${names[1]} +${names.length - 2} play`;
}

interface FriendGameSuggestionsProps {
  games: DiscoveryGame[];
  /** Game ids whose add request is currently in flight (spinner on Add). */
  addingGameIds: string[];
  /** Game ids added this session — the row flips to a "✓ Added" pill. */
  addedGameIds: string[];
  onAdd: (game: DiscoveryGame) => void;
  /**
   * Hide the per-row "Sam plays" line. Used by the post-accept picker, where
   * a single friend's name already heads the section so repeating it on every
   * row reads as noise.
   */
  hideFriendLine?: boolean;
  /** testID stem → `${testIDPrefix}-row-${id}` / `${testIDPrefix}-add-${id}`. */
  testIDPrefix: string;
}

export function FriendGameSuggestions({
  games,
  addingGameIds,
  addedGameIds,
  onAdd,
  hideFriendLine = false,
  testIDPrefix,
}: FriendGameSuggestionsProps) {
  return (
    <View style={styles.list}>
      {games.map((dg) => {
        const adding = addingGameIds.includes(dg.game.id);
        const added = addedGameIds.includes(dg.game.id);
        // Games already in My Games (only present in the `includeOwned` feed)
        // stay in the ranked list for context but aren't addable.
        const owned = dg.inMyGames;
        return (
          <View key={dg.game.id} style={styles.row} testID={`${testIDPrefix}-row-${dg.game.id}`}>
            <GameCover iconUrl={dg.game.iconUrl} size={COVER} />
            <View style={styles.text}>
              <Text variant="label" numberOfLines={1} style={styles.title}>
                {dg.game.title}
              </Text>
              {hideFriendLine ? null : (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {friendsPlayLine(dg.friends)}
                </Text>
              )}
            </View>
            {owned || added ? (
              <View
                style={styles.addedMark}
                testID={`${testIDPrefix}-${owned ? "owned" : "added"}-${dg.game.id}`}
              >
                <PixelIcon name="check" size={16} color={tokens.neon.chartreuse} />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${dg.game.title}`}
                onPress={() => onAdd(dg)}
                disabled={adding}
                testID={`${testIDPrefix}-add-${dg.game.id}`}
                hitSlop={6}
                style={({ pressed }) => [styles.addKey, pressed && styles.addKeyPressed]}
              >
                {adding ? (
                  <ActivityIndicator size="small" color={tokens.neon.pink} />
                ) : (
                  <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
                )}
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const COVER = 28;

const styles = StyleSheet.create({
  list: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 48,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  text: { flex: 1, minWidth: 0 },
  title: { color: tokens.text.primary },
  addKey: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  addKeyPressed: { backgroundColor: tokens.accent.muted },
  addedMark: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
