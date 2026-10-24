import { Button, Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import {
  HANDOFF_PLATFORM,
  openHighScoreAppStore,
  openHighScoreWeb,
} from "../../lib/highscoreHandoff";

/**
 * Compact in-page variant of `GamesMovedScreen` for surfaces that still exist
 * post-sunset but used to embed a games panel (a friend's profile).
 */
export function GamesMovedCard({ name, isSelf }: { name: string; isSelf: boolean }) {
  const ios = HANDOFF_PLATFORM !== "web";
  return (
    <View style={styles.card} testID="games-moved-card">
      <Text variant="label" style={styles.title}>
        {isSelf ? "Your" : `${name}'s`} games are in HighScore
      </Text>
      <Button
        label={ios ? "Get the app" : "Open highscore.live"}
        variant="secondary"
        onPress={ios ? openHighScoreAppStore : () => openHighScoreWeb()}
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
  title: { textAlign: "center" },
});
