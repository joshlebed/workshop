// "Friends only" checkbox on the Add-game screen. On (default): only games
// your friends play, with who plays each. Off: the official catalog,
// platform-wide counts. One row, whole row tappable, `checkbox` role.

import { haptics, homeLayout, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";

interface FriendsOnlyToggleProps {
  value: boolean;
  onChange: (next: boolean) => void;
  testID?: string;
}

export function FriendsOnlyToggle({
  value,
  onChange,
  testID = "friends-only-toggle",
}: FriendsOnlyToggleProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      // RNW drops `accessibilityState` (root CLAUDE.md); `aria-checked` reaches the DOM.
      aria-checked={value}
      accessibilityLabel="Friends only"
      testID={testID}
      hitSlop={6}
      onPress={() => {
        haptics.selection();
        onChange(!value);
      }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && styles.rowHover,
      ]}
    >
      <View style={[styles.box, value && styles.boxChecked]}>
        {value ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <View style={styles.text}>
        <Text variant="label" style={styles.label}>
          Friends only
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {value ? "Games your friends play" : "Every game in the catalog"}
        </Text>
      </View>
    </Pressable>
  );
}

const BOX = 22;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    marginHorizontal: homeLayout.horizontalInset,
    marginBottom: tokens.space.xs,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.md,
  },
  rowHover: { backgroundColor: `${tokens.text.primary}0A` },
  box: {
    width: BOX,
    height: BOX,
    borderRadius: tokens.radius.sm,
    borderWidth: 1.5,
    borderColor: tokens.border.strong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
  },
  boxChecked: { backgroundColor: tokens.accent.default, borderColor: tokens.accent.default },
  check: {
    color: tokens.text.onAccent,
    fontSize: 14,
    fontWeight: tokens.font.weight.bold,
    lineHeight: 16,
  },
  text: { flex: 1, minWidth: 0, gap: 1 },
  label: { fontSize: tokens.font.size.md, color: tokens.text.primary },
});
