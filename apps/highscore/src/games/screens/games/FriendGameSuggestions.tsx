// Friend-game discovery list (G3, issue #293) — a presentational column of
// "games your friends play that you haven't added", each one-tap addable.
// Shared by three surfaces: the + add-game sheet (suggestions above the URL
// field), the Games-home "friends but no games" empty state, and the
// post-accept picker. Data + add mutations live at the call site; this file
// only renders rows and reports taps.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { HsText, hsColor, hsSpace } from "../../../theme";

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
            <View style={styles.cover}>
              {dg.game.iconUrl ? (
                <Image
                  source={{ uri: dg.game.iconUrl }}
                  style={styles.coverImage}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <HsText style={styles.coverGlyph}>🎮</HsText>
              )}
            </View>
            <View style={styles.text}>
              <HsText variant="label" numberOfLines={1} style={styles.title}>
                {dg.game.title}
              </HsText>
              {hideFriendLine ? null : (
                <HsText variant="caption" tone="secondary" numberOfLines={1}>
                  {friendsPlayLine(dg.friends)}
                </HsText>
              )}
            </View>
            {owned ? (
              <View style={styles.addedPill} testID={`${testIDPrefix}-owned-${dg.game.id}`}>
                <HsText style={styles.addedText} numberOfLines={1}>
                  ✓ In your games
                </HsText>
              </View>
            ) : added ? (
              <View style={styles.addedPill} testID={`${testIDPrefix}-added-${dg.game.id}`}>
                <HsText style={styles.addedText}>✓ Added</HsText>
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
                  <ActivityIndicator size="small" color={hsColor.primary} />
                ) : (
                  <HsText style={styles.addLabel}>Add</HsText>
                )}
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const COVER = 40;

const styles = StyleSheet.create({
  list: { gap: hsSpace.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.md,
    paddingVertical: hsSpace.sm,
    paddingHorizontal: hsSpace.md,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: hsColor.border,
    backgroundColor: hsColor.surface2,
  },
  cover: {
    width: COVER,
    height: COVER,
    borderRadius: 0,
    backgroundColor: `${hsColor.primary}1F`,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImage: { width: COVER, height: COVER, borderRadius: 0 },
  coverGlyph: { fontSize: 20, lineHeight: 26 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 16, color: hsColor.textPrimary },
  // Pink = the one interactive color; Add is a small pink-bezel action.
  addBtn: {
    minWidth: 64,
    paddingHorizontal: hsSpace.md,
    paddingVertical: hsSpace.sm,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `${hsColor.primary}14`,
    borderWidth: 1,
    borderColor: `${hsColor.primary}66`,
  },
  addBtnHover: { backgroundColor: `${hsColor.primary}2B` },
  addBtnBusy: { opacity: 0.8 },
  addLabel: {
    color: hsColor.primaryTint,
    fontSize: 13,
    fontWeight: "600",
  },
  addedPill: {
    minWidth: 64,
    paddingHorizontal: hsSpace.md,
    paddingVertical: hsSpace.sm,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // "✓ Added" — something good happened: chartreuse, earned.
  addedText: {
    color: hsColor.success,
    fontSize: 13,
    fontWeight: "600",
  },
});
