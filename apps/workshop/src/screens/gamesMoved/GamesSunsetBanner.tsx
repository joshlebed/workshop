import { WORKSHOP_GAMES_SUNSET_AT } from "@workshop/shared/constants";
import { Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet } from "react-native";
import {
  HANDOFF_PLATFORM,
  openHighScoreAppStore,
  openHighScoreWeb,
} from "../../lib/highscoreHandoff";

const sunsetLabel = new Date(WORKSHOP_GAMES_SUNSET_AT).toLocaleDateString(undefined, {
  month: "short",
  day: "numeric",
});

/**
 * Pre-sunset notice pinned above Workshop's frozen Games home. Not
 * dismissable on purpose: it's a one-week countdown, and the same OTA flips
 * the whole tab to `GamesMovedScreen` when the date passes.
 */
export function GamesSunsetBanner() {
  const ios = HANDOFF_PLATFORM !== "web";
  const cta = ios ? "Get the app" : "Open highscore.live";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Games move to HighScore ${sunsetLabel}. ${cta}.`}
      onPress={ios ? openHighScoreAppStore : () => openHighScoreWeb()}
      testID="games-sunset-banner"
      style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
    >
      <Text style={styles.glyph}>🕹️</Text>
      <Text variant="label" style={styles.copy}>
        Games move to HighScore {sunsetLabel}
      </Text>
      <Text variant="label" style={styles.cta}>
        {cta} →
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginHorizontal: tokens.space.md,
    marginTop: tokens.space.sm,
    marginBottom: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
    borderWidth: 1,
    borderColor: tokens.accent.default,
  },
  bannerPressed: { opacity: 0.85 },
  glyph: { fontSize: 20, lineHeight: 24 },
  copy: { flex: 1 },
  cta: { color: tokens.accent.default },
});
