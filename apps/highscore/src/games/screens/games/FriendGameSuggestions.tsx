// Friend-game discovery list (G3, issue #293) — a presentational column of
// "games your friends play that you haven't added", each one-tap addable.
// Shared by three surfaces: the + add-game sheet (suggestions above the URL
// field), the Games-home "friends but no games" empty state, and the
// post-accept picker. Data + add mutations live at the call site; this file
// only renders rows and reports taps.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { PixelIcon } from "../../../theme/PixelIcon";
import { Text } from "../../../theme/Text";
import { tokens } from "../../../theme/tokens";

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
          <View
            key={dg.game.id}
            style={[styles.row, owned && styles.rowOwned]}
            testID={`${testIDPrefix}-row-${dg.game.id}`}
          >
            <View style={styles.cover}>
              {dg.game.iconUrl ? (
                <Image
                  source={{ uri: dg.game.iconUrl }}
                  style={styles.coverImage}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
              )}
            </View>
            <View style={styles.text}>
              <Text variant="heading" numberOfLines={1} style={styles.title}>
                {dg.game.title}
              </Text>
              {hideFriendLine ? null : (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {friendsPlayLine(dg.friends)}
                </Text>
              )}
            </View>
            {/* Owned rows stay in the ranked list for context but say so with a
                check, not a repeated "in your games" pill on every one. */}
            {owned || added ? (
              <View
                style={styles.state}
                testID={`${testIDPrefix}-${owned ? "owned" : "added"}-${dg.game.id}`}
              >
                <PixelIcon
                  name="check"
                  size={16}
                  color={added ? tokens.neon.chartreuse : tokens.text.secondary}
                />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Add ${dg.game.title}`}
                onPress={() => onAdd(dg)}
                disabled={adding}
                testID={`${testIDPrefix}-add-${dg.game.id}`}
                hitSlop={6}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.addBtn,
                  (pressed || hovered) && styles.addBtnHover,
                  adding && styles.addBtnBusy,
                ]}
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

const COVER = 24;

const styles = StyleSheet.create({
  list: {},
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  rowOwned: { opacity: 0.5 },
  cover: {
    width: COVER,
    height: COVER,
    backgroundColor: tokens.bg.raised,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImage: { width: COVER, height: COVER },
  text: { flex: 1, minWidth: 0, gap: tokens.space.xs },
  title: { fontSize: 11, color: tokens.text.primary },
  addBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  addBtnHover: { opacity: 0.6 },
  addBtnBusy: { opacity: 0.8 },
  state: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
});
