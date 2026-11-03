// Full-screen, blocking "Update required" — shown when the installed binary
// is below the operator-set `minimumVersion`. No way past it but the store.

import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { openStoreUrl } from "../hooks/useAppRelease";
import { Button, Text, tokens } from "../theme";

export function UpdateRequiredScreen({
  storeUrl,
  message,
}: {
  storeUrl: string | null;
  message: string | null;
}) {
  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.root} testID="update-required">
      <View style={styles.center}>
        <View style={styles.column}>
          <Text variant="display" style={styles.headline} accessibilityRole="header">
            UPDATE REQUIRED
          </Text>
          <Text tone="secondary" style={styles.centerText}>
            {message ??
              "This version of HighScore is no longer supported. Update from the App Store to keep playing."}
          </Text>
          <Button
            label="Update on the App Store"
            size="lg"
            onPress={() => openStoreUrl(storeUrl)}
            testID="update-required-open-store"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
  },
  column: { width: "100%", maxWidth: 360, gap: tokens.space.lg },
  headline: {
    textAlign: "center",
    color: tokens.neon.yellow,
    fontSize: tokens.font.size.lg,
    lineHeight: 28,
  },
  centerText: { textAlign: "center" },
});
