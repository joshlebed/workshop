import { Button, HomeHeader, homeLayout, Screen, Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import { Wordmark } from "../../src/components/Wordmark";
import { useAuth } from "../../src/hooks/useAuth";

// Placeholder Games home. Proves the shell boots and the shared session
// resolves against the same backend account Workshop uses. PR-4 replaces the
// body with the real Games surfaces (catalog, standings, DayRail, paste loop).
export default function GamesHome() {
  const { user, signOut } = useAuth();

  return (
    <Screen testID="games-home">
      <HomeHeader left={<Wordmark />} />
      <View style={styles.body}>
        <Text variant="heading">Daily games</Text>
        <Text tone="secondary">
          {user?.displayName
            ? `Signed in as ${user.displayName}. Your Workshop account carried over.`
            : "Signed in."}
        </Text>
        <Text tone="muted" testID="games-home-placeholder">
          The scoreboard lands here next — catalog, standings and the paste loop are moving over
          from Workshop.
        </Text>
        <View style={styles.actions}>
          <Button
            testID="sign-out"
            label="Sign out"
            variant="ghost"
            size="md"
            onPress={() => void signOut()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: homeLayout.contentTopGap,
    gap: tokens.space.md,
  },
  actions: { alignItems: "flex-start", paddingTop: tokens.space.lg },
});
