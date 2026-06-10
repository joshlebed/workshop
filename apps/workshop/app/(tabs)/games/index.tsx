import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";
import { Screen, Text, tokens } from "../../../src/ui/index";

// Placeholder Games home (G0). The real games list lands in G1b — keep this
// to an empty state so the tab shell can ship independently.
export default function GamesHome() {
  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }
  return (
    <Screen testID="games-home">
      <View style={styles.body}>
        <Text variant="title">Games</Text>
        <Text tone="secondary" style={styles.subtitle}>
          Your daily games will live here soon.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    padding: tokens.space.lg,
  },
  subtitle: { textAlign: "center" },
});
