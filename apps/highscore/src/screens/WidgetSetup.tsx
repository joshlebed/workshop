// `/widget-setup` (You → Account → Home Screen widget): how to add the iOS
// widget and what it shows. Renders on any binary; the entry row is gated to
// iOS 1.4.0+ (`widgetEntrySupported`).

import { goBack } from "@workshop/ui/navigation";
import { useEffect } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { reportWidgetEvent } from "../api/telemetry";
import { WidgetHowTo } from "../components/WidgetHowTo";
import { useAuth } from "../hooks/useAuth";
import { Card, IconButton, PixelIcon, Screen, Text, tokens } from "../theme";

export default function WidgetSetup() {
  const { token } = useAuth();
  useEffect(() => {
    void reportWidgetEvent({ event: "howto_opened", source: "settings" }, token);
  }, [token]);
  return (
    <Screen style={styles.root} testID="widget-setup">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="caption" tone="muted" style={styles.eyebrow}>
            Settings
          </Text>
          <Text variant="heading" numberOfLines={1} accessibilityRole="header">
            Home Screen widget
          </Text>
        </View>
        <IconButton
          accessibilityLabel="Close widget setup"
          onPress={() => goBack("/profile")}
          testID="widget-setup-close"
        >
          <PixelIcon name="close" size={24} color={tokens.text.secondary} />
        </IconButton>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.card}>
          <Text variant="heading">Who's played today</Text>
          <Text tone="secondary">
            Today's games, a dot for each friend who has posted, and whether you have. Tap a game to
            open its board.
          </Text>
          <WidgetHowTo testID="widget-setup-steps" />
        </Card>
        <Text variant="caption" tone="muted">
          The widget shows game names and how many friends have played. Friends' names and scores
          stay in the app.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { textTransform: "uppercase", letterSpacing: 1 },
  body: { padding: tokens.space.lg, gap: tokens.space.lg, paddingBottom: tokens.space.xxl },
  card: { gap: tokens.space.md },
});
