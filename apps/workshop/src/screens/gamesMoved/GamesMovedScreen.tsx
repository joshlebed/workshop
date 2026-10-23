import { Button, HomeHeader, InlineTabSwitch, Screen, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import {
  HANDOFF_IS_NATIVE,
  type HighScoreTarget,
  openHighScore,
  openHighScoreAppStore,
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
 * Post-sunset replacement for every Workshop games surface: a persistent
 * "Daily games moved to HighScore" hand-off. Native tries the HighScore app
 * and falls back to the App Store; web goes to highscore.live. Deliberately
 * not dismissable — this is the one place a Workshop user learns where their
 * games went.
 */
export function GamesMovedScreen({ target, showTabSwitch, onCancel }: GamesMovedScreenProps) {
  const sharing = !!target?.share;
  const title = sharing ? "Post this score in HighScore" : "Daily games moved to HighScore";
  const body = sharing
    ? "Workshop no longer posts scores. HighScore picks up right where you left off — same account, same games, same friends."
    : "Your games, scores, streaks, and friends are all in HighScore. Sign in with the same account and everything is already there.";
  const primaryLabel = HANDOFF_IS_NATIVE
    ? sharing
      ? "Post in HighScore"
      : "Open HighScore"
    : sharing
      ? "Post on highscore.live"
      : "Open highscore.live";

  return (
    <Screen style={styles.root} testID="games-moved">
      {showTabSwitch ? <HomeHeader left={<InlineTabSwitch />} /> : null}
      <View style={styles.body}>
        <Text style={styles.glyph}>🕹️</Text>
        <Text variant="title" style={styles.title}>
          {title}
        </Text>
        <Text tone="secondary" style={styles.copy}>
          {body}
        </Text>
        <Button
          label={primaryLabel}
          onPress={() => {
            void openHighScore(target);
          }}
          testID="games-moved-open"
          style={styles.primary}
        />
        {HANDOFF_IS_NATIVE ? (
          <Pressable
            accessibilityRole="link"
            onPress={openHighScoreAppStore}
            testID="games-moved-app-store"
            hitSlop={8}
          >
            <Text variant="caption" tone="muted" style={styles.link}>
              Don't have it yet? Get HighScore on the App Store
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" tone="muted" style={styles.link}>
            On an iPhone? HighScore is on the App Store.
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
  copy: { textAlign: "center", maxWidth: 360 },
  primary: { alignSelf: "stretch", marginTop: tokens.space.sm },
  link: { textAlign: "center", textDecorationLine: "underline" },
});
