// The three steps to put the HighScore widget on the iOS Home Screen. Shared
// by the Games-home card and `/widget-setup` (You → Account → Home Screen
// widget). iOS 17+ wording; the steps are the system's, not ours.

import { StyleSheet, View } from "react-native";
import { Text, tokens } from "../theme";

export const WIDGET_HOW_TO_STEPS = [
  "Touch and hold an empty spot on your Home Screen until the apps jiggle.",
  "Tap Edit in the top corner, then Add Widget, and search for HighScore.",
  "Pick the small or medium size, tap Add Widget, then Done.",
] as const;

export function WidgetHowTo({ testID }: { testID?: string }) {
  return (
    <View style={styles.list} testID={testID}>
      {WIDGET_HOW_TO_STEPS.map((step, i) => (
        <View key={step} style={styles.row}>
          <View style={styles.badge}>
            <Text variant="label" style={styles.badgeText}>
              {String(i + 1)}
            </Text>
          </View>
          <Text variant="caption" tone="secondary" style={styles.step}>
            {step}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: tokens.space.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.sm },
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
    borderWidth: 1,
    borderColor: tokens.neon.pink,
  },
  badgeText: { color: tokens.neon.pink },
  step: { flex: 1, minWidth: 0, paddingTop: 2 },
});
