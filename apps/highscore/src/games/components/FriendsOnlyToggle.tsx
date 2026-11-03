// "Friends only" checkbox on the Add-game screen. On (default): only games
// your friends play, with who plays each. Off: the official catalog,
// platform-wide counts. One row, whole row tappable, `checkbox` role.

import { haptics } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";
import { homeLayout, PixelIcon, Text, tokens } from "../../theme";

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
        {value ? <PixelIcon name="check" size={16} color={tokens.text.onAccent} /> : null}
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
    borderRadius: tokens.radius.sm,
  },
  rowHover: { backgroundColor: tokens.bg.surface },
  box: {
    width: BOX,
    height: BOX,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
  },
  boxChecked: { backgroundColor: tokens.neon.pink, borderColor: tokens.neon.pink },
  text: { flex: 1, minWidth: 0, gap: 1 },
  label: { fontSize: tokens.font.size.md, color: tokens.text.primary },
});
