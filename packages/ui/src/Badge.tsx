import { StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface BadgeProps {
  /** Short text: a count ("3", "9+") or a one-word status ("Owner"). */
  label: string;
  tone?: "accent" | "neutral" | "danger";
  /** Ring in the background color, for a badge overlapping an icon. */
  ringColor?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
  testID?: string;
}

/** A small pill for counts and one-word statuses. */
export function Badge({
  label,
  tone = "neutral",
  ringColor,
  accessibilityLabel,
  style,
  testID,
}: BadgeProps) {
  return (
    <View
      style={[
        styles.base,
        toneStyle[tone],
        ringColor ? { borderWidth: 2, borderColor: ringColor } : null,
        style,
      ]}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Text variant="caption" style={[styles.label, { color: labelColor[tone] }]}>
        {label}
      </Text>
    </View>
  );
}

const toneStyle: Record<NonNullable<BadgeProps["tone"]>, ViewStyle> = {
  accent: { backgroundColor: tokens.accent.default },
  neutral: { backgroundColor: tokens.bg.elevated },
  danger: { backgroundColor: tokens.status.danger },
};

const labelColor: Record<NonNullable<BadgeProps["tone"]>, string> = {
  accent: tokens.text.onAccent,
  neutral: tokens.text.secondary,
  danger: tokens.text.onAccent,
};

const styles = StyleSheet.create({
  base: {
    minWidth: 18,
    // A floor, not a height: the label grows with the user's text size.
    minHeight: 18,
    paddingHorizontal: tokens.space.xs,
    borderRadius: tokens.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontWeight: tokens.font.weight.bold, fontVariant: ["tabular-nums"] },
});
