import { Button, Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import { HANDOFF_IS_NATIVE, openHighScore } from "../../lib/highscoreHandoff";

/**
 * Compact in-page variant of `GamesMovedScreen` for surfaces that still exist
 * post-sunset but used to embed a games panel (a friend's profile).
 */
export function GamesMovedCard({ name, isSelf }: { name: string; isSelf: boolean }) {
  const whose = isSelf ? "Your games" : `${name}'s games`;
  return (
    <View style={styles.card} testID="games-moved-card">
      <Text style={styles.glyph}>🕹️</Text>
      <Text variant="label" style={styles.title}>
        {whose} live in HighScore now
      </Text>
      <Text variant="caption" tone="muted" style={styles.text}>
        Daily games moved out of Workshop. Same account, same friends.
      </Text>
      <Button
        label={HANDOFF_IS_NATIVE ? "Open HighScore" : "Open highscore.live"}
        variant="secondary"
        onPress={() => {
          void openHighScore();
        }}
        testID="games-moved-card-open"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: tokens.space.sm,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  glyph: { fontSize: 28, lineHeight: 34 },
  title: { textAlign: "center" },
  text: { textAlign: "center" },
});
