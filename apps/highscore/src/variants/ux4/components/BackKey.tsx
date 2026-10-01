// Back, named. A lone chevron in the corner is the most anonymous control in
// mobile design — it tells you there is a previous screen but not which one.
// This one says where it goes, which matters here because a detail screen can
// be reached from either projection, the friends list, or a share link.

import { Pressable, StyleSheet } from "react-native";
import { layout, PixelIcon, Text, tokens } from "../theme";

interface BackKeyProps {
  /** Where you land, e.g. "Today". */
  label: string;
  onPress: () => void;
  testID?: string;
}

export function BackKey({ label, onPress, testID }: BackKeyProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      onPress={onPress}
      testID={testID}
      hitSlop={8}
      style={({ pressed }) => [styles.key, pressed && styles.pressed]}
    >
      <PixelIcon name="chevron-left" size={16} color={tokens.text.secondary} />
      <Text variant="cell" tone="secondary" style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  key: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minHeight: 32,
    paddingRight: tokens.space.sm,
    paddingLeft: layout.inset - 4,
  },
  pressed: { opacity: 0.6 },
  label: { letterSpacing: 1 },
});
