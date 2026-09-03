// What's left of your day, in the projection that's about people rather than
// games. BY GAME already puts a Play key on every unplayed row; BY PLAYER
// doesn't have per-game rows, so without this the one row that's actually
// actionable — yours — would be the only row you couldn't act on.

import type { MyGame } from "@workshop/shared/games";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text, tokens } from "../../../theme";
import { GameCover } from "../../components/GameCover";

interface YourTurnProps {
  /** Games the viewer hasn't posted to today. */
  games: MyGame[];
  onPlay: (game: MyGame) => void;
}

export function YourTurn({ games, onPlay }: YourTurnProps) {
  if (games.length === 0) return null;
  return (
    <View style={styles.block} testID="your-turn">
      <Text variant="eyebrow" tone="secondary" style={styles.label}>
        {games.length === 1 ? "1 left — tap to play" : `${games.length} left — tap to play`}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {games.map((mg) => (
            <Pressable
              key={mg.gameId}
              accessibilityRole="link"
              accessibilityLabel={`Play ${mg.game.title}`}
              onPress={() => onPlay(mg)}
              testID={`your-turn-${mg.gameId}`}
              style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            >
              <GameCover iconUrl={mg.game.iconUrl} size={20} />
              <Text variant="cell" style={styles.keyLabel} numberOfLines={1}>
                {mg.game.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: tokens.space.xs },
  label: { letterSpacing: 1 },
  row: { flexDirection: "row", gap: tokens.space.xs },
  key: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    maxWidth: 168,
    height: 32,
    paddingHorizontal: tokens.space.xs,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  keyPressed: { borderColor: tokens.neon.pink, backgroundColor: tokens.bg.surface },
  keyLabel: { flexShrink: 1, color: tokens.text.primary, letterSpacing: 0 },
});
