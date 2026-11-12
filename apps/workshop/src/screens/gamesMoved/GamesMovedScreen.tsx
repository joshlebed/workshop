import { Button, Screen, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import {
  HANDOFF_PLATFORM,
  type HighScoreTarget,
  openHighScore,
  openHighScoreAppStore,
  openHighScoreWeb,
} from "../../lib/highscoreHandoff";

interface GamesMovedScreenProps {
  /** Where in HighScore to land (e.g. the play link's `/g/:token`). */
  target?: HighScoreTarget;
  /** Dismiss back into Workshop. */
  onCancel?: () => void;
  /** What moved. Defaults to the games copy; the friend-invite hand-off overrides it. */
  copy?: { glyph: string; title: string; body: string };
}

const GAMES_COPY = {
  glyph: "🕹️",
  title: "Games moved to HighScore",
  body: "Same account. Everything's there.",
};

/**
 * HighScore hand-off for inbound links to surfaces that moved there: play
 * links (`/g/:token`) and friend invites (`/friends/accept/:token`). Pushes
 * the iOS app first wherever the user is on an iPhone (native build or iOS
 * browser); desktop / Android get highscore.live.
 */
export function GamesMovedScreen({ target, onCancel, copy = GAMES_COPY }: GamesMovedScreenProps) {
  // Primary = the push. Secondary = the escape hatch for people who already
  // have the app (native) or who'd rather use the web (iOS browser).
  let primary: { label: string; onPress: () => void };
  let secondary: { label: string; onPress: () => void } | null = null;
  if (HANDOFF_PLATFORM === "ios") {
    primary = { label: "Open in HighScore", onPress: () => void openHighScore(target) };
    secondary = { label: "Get the app", onPress: openHighScoreAppStore };
  } else if (HANDOFF_PLATFORM === "ios-web") {
    primary = { label: "Get HighScore on the App Store", onPress: openHighScoreAppStore };
    secondary = { label: "Use the web version", onPress: () => openHighScoreWeb(target) };
  } else {
    primary = { label: "Open highscore.live", onPress: () => openHighScoreWeb(target) };
  }

  return (
    <Screen style={styles.root} testID="games-moved">
      <View style={styles.body}>
        <Text style={styles.glyph}>{copy.glyph}</Text>
        <Text variant="title" style={styles.title}>
          {copy.title}
        </Text>
        <Text tone="secondary" style={styles.copy}>
          {copy.body}
        </Text>
        <Button
          label={primary.label}
          onPress={primary.onPress}
          testID="games-moved-primary"
          style={styles.primary}
        />
        {secondary ? (
          <Pressable
            accessibilityRole="link"
            onPress={secondary.onPress}
            testID="games-moved-secondary"
            style={styles.linkTarget}
          >
            <Text variant="caption" tone="muted" style={styles.link}>
              {secondary.label}
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="muted" style={styles.link}>
            On iPhone? It's on the App Store.
          </Text>
        )}
        {onCancel ? (
          <Button label="Not now" variant="ghost" onPress={onCancel} testID="games-moved-cancel" />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: tokens.bg.canvas },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.md,
  },
  glyph: { fontSize: 56, lineHeight: 68, textAlign: "center" },
  title: { textAlign: "center" },
  copy: { textAlign: "center" },
  primary: { alignSelf: "stretch", marginTop: tokens.space.sm },
  link: { textAlign: "center", textDecorationLine: "underline" },
  // Web ignores hitSlop: the box itself is the 44pt target.
  linkTarget: {
    minHeight: tokens.hit,
    justifyContent: "center",
    paddingHorizontal: tokens.space.sm,
  },
});
