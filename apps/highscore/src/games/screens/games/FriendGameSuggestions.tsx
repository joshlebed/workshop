// Friend-game discovery list (G3, issue #293) — a presentational column of
// "games your friends play that you haven't added", each one-tap addable.
// Shared by the + add-game sheet and the empty timeline. Data + add mutations
// live at the call site; this file only renders rows and reports taps.
//
// Rendered as ledger lines rather than cards: the same grammar as the feed, so
// a game reads the same whether you already have it or not.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, Text, tokens } from "../../../theme";
import { GameGlyph } from "../../../timeline/GameLedger";

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
  /** Game ids added this session — the row flips to a checked state. */
  addedGameIds: string[];
  onAdd: (game: DiscoveryGame) => void;
  /**
   * Hide the per-row "Sam plays" line. Used where a single friend's name
   * already heads the section so repeating it on every row reads as noise.
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
            <GameGlyph iconUrl={dg.game.iconUrl} size={20} />
            <View style={styles.text}>
              <Text variant="title" numberOfLines={1}>
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
                style={styles.done}
                testID={`${testIDPrefix}-${owned ? "owned" : "added"}-${dg.game.id}`}
              >
                <PixelIcon name="check" size={16} color={tokens.neon.chartreuse} />
                <Text variant="eyebrow" tone="success">
                  {owned ? "Yours" : "Added"}
                </Text>
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
                  <Text variant="eyebrow" tone="link">
                    Add
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: tokens.space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 44,
  },
  text: { flex: 1, minWidth: 0, gap: 1 },
  done: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  addBtn: {
    paddingHorizontal: tokens.space.md,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  addBtnHover: { backgroundColor: tokens.accent.muted },
  addBtnBusy: { opacity: 0.7 },
});
