import { Button, HomeHeader, InlineTabSwitch, Screen, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import {
  HANDOFF_PLATFORM,
  type HighScoreTarget,
  openHighScore,
  openHighScoreAppStore,
  openHighScoreWeb,
} from "../../lib/highscoreHandoff";

interface GamesMovedScreenProps {
  /** Where in HighScore to land; a `share` payload pre-fills its score picker. */
  target?: HighScoreTarget;
  /** Keep the Lists / Games switch so the tab stays navigable (Games tab only). */
  showTabSwitch?: boolean;
  /** Optional dismiss (share / play-link surfaces live outside the tab shell). */
  onCancel?: () => void;
}

/**
 * Post-sunset replacement for every Workshop games surface. Pushes the iOS
 * app first wherever the user is on an iPhone (native build or iOS browser);
 * desktop / Android get highscore.live. Not dismissable on the Games tab —
 * it's the one place a Workshop user learns where their games went.
 */
export function GamesMovedScreen({ target, showTabSwitch, onCancel }: GamesMovedScreenProps) {
  const sharing = !!target?.share;
  const title = sharing ? "Post this in HighScore" : "Games moved to HighScore";

  // Primary = the push. Secondary = the escape hatch for people who already
  // have the app (native) or who'd rather use the web (iOS browser).
  let primary: { label: string; onPress: () => void };
  let secondary: { label: string; onPress: () => void } | null = null;
  if (HANDOFF_PLATFORM === "ios") {
    primary = sharing
      ? { label: "Post in HighScore", onPress: () => void openHighScore(target) }
      : { label: "Get HighScore on the App Store", onPress: openHighScoreAppStore };
    secondary = sharing
      ? { label: "Get the app", onPress: openHighScoreAppStore }
      : { label: "Already have it? Open HighScore", onPress: () => void openHighScore() };
  } else if (HANDOFF_PLATFORM === "ios-web") {
    primary = { label: "Get HighScore on the App Store", onPress: openHighScoreAppStore };
    secondary = { label: "Use the web version", onPress: () => openHighScoreWeb(target) };
  } else {
    primary = {
      label: sharing ? "Post on highscore.live" : "Open highscore.live",
      onPress: () => openHighScoreWeb(target),
    };
  }

  return (
    <Screen style={styles.root} testID="games-moved">
      {showTabSwitch ? <HomeHeader left={<InlineTabSwitch />} /> : null}
      <View style={styles.body}>
        <Text style={styles.glyph}>🕹️</Text>
        <Text variant="title" style={styles.title}>
          {title}
        </Text>
        <Text tone="secondary" style={styles.copy}>
          Same account. Everything's there.
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
            hitSlop={8}
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
});
