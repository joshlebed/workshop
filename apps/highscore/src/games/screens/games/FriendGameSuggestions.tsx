// "Games your friends play" — a ruled column, whole rows tappable. Used by the
// deck's slot cartridge and by the post-accept picker after a friend invite.
// Data + add mutations live at the call site; this file renders rows and
// reports taps.

import type { DiscoveryGame } from "@workshop/shared/games";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { CartridgeLabel } from "../../../deck/CartridgeLabel";
import { PixelIcon, Text, tokens } from "../../../theme";

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
  /** Game ids whose add request is in flight. */
  addingGameIds: string[];
  /** Game ids added this session. */
  addedGameIds: string[];
  onAdd: (game: DiscoveryGame) => void;
  /**
   * Hide the per-row "Sam plays" line — the post-accept picker already names
   * the friend in its heading.
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
    <View>
      {games.map((dg) => {
        const adding = addingGameIds.includes(dg.game.id);
        const added = addedGameIds.includes(dg.game.id);
        // Games already in the deck stay in the ranked list for context but
        // aren't addable.
        const owned = dg.inMyGames;
        const settled = owned || added;
        return (
          <Pressable
            key={dg.game.id}
            accessibilityRole="button"
            accessibilityLabel={
              settled ? `${dg.game.title}, already added` : `Add ${dg.game.title}`
            }
            onPress={settled || adding ? undefined : () => onAdd(dg)}
            testID={
              settled ? `${testIDPrefix}-row-${dg.game.id}` : `${testIDPrefix}-add-${dg.game.id}`
            }
            style={({ pressed }) => [styles.row, pressed && !settled && styles.rowPressed]}
          >
            <CartridgeLabel title={dg.game.title} size={COVER} />
            <View style={styles.text}>
              <Text variant="label" numberOfLines={1} tone={settled ? "secondary" : "primary"}>
                {dg.game.title}
              </Text>
              {hideFriendLine ? null : (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {friendsPlayLine(dg.friends)}
                </Text>
              )}
            </View>
            {adding ? (
              <ActivityIndicator size="small" color={tokens.neon.pink} />
            ) : settled ? (
              <View
                testID={
                  owned
                    ? `${testIDPrefix}-owned-${dg.game.id}`
                    : `${testIDPrefix}-added-${dg.game.id}`
                }
              >
                <PixelIcon name="check" size={16} color={tokens.neon.chartreuse} />
              </View>
            ) : (
              <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const COVER = 28;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    minHeight: 48,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  rowPressed: { backgroundColor: tokens.bg.surface },
  text: { flex: 1, minWidth: 0 },
});
