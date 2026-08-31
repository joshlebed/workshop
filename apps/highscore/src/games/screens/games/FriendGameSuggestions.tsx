// Friend-game discovery list (G3, issue #293) — a presentational column of
// "games your friends play that you haven't added", each one-tap addable.
// Shared by three surfaces: the + add-game sheet (suggestions above the URL
// field), the Games-home "friends but no games" empty state, and the
// post-accept picker. Data + add mutations live at the call site; this file
// only renders rows and reports taps.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from "react-native";
import { bezel, colors, font, PixelIcon, space, Text } from "../../../theme";

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
                <Text style={styles.coverGlyph}>🎮</Text>
              )}
            </View>
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
            {owned ? (
              <View style={styles.addedPill} testID={`${testIDPrefix}-owned-${dg.game.id}`}>
                <PixelIcon name="check" size={16} color={colors.textSecondary} />
                <Text style={styles.addedText} numberOfLines={1}>
                  In your games
                </Text>
              </View>
            ) : added ? (
              <View style={styles.addedPill} testID={`${testIDPrefix}-added-${dg.game.id}`}>
                <PixelIcon name="check" size={16} color={colors.success} />
                <Text style={[styles.addedText, styles.addedTextSuccess]}>Added</Text>
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
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.addLabel}>Add</Text>
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
  list: { gap: space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 0,
    borderWidth: bezel,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  cover: {
    width: COVER,
    height: COVER,
    borderRadius: 0,
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  coverImage: { width: COVER, height: COVER, borderRadius: 0 },
  coverGlyph: { fontSize: 20 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: font.size.md, color: colors.textPrimary },
  addBtn: {
    minWidth: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `${colors.primary}26`,
    borderWidth: bezel,
    borderColor: colors.primary,
  },
  addBtnHover: { backgroundColor: `${colors.primary}40` },
  addBtnBusy: { opacity: 0.8 },
  addLabel: {
    color: colors.primary,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },
  addedPill: {
    minWidth: 64,
    flexDirection: "row",
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  addedText: {
    color: colors.textSecondary,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },
  addedTextSuccess: { color: colors.success },
});
