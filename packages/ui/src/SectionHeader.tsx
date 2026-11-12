import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface SectionHeaderProps {
  title: string;
  /** Quiet trailing meta or a small action (a count, "Clear"). */
  trailing?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

/** The uppercase tracked label above a group of rows or fields. */
export function SectionHeader({ title, trailing, style, testID }: SectionHeaderProps) {
  return (
    <View style={[styles.root, style]} testID={testID}>
      <Text variant="eyebrow" accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
    minHeight: 24,
  },
  title: { flexShrink: 1 },
});
