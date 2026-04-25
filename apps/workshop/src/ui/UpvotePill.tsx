import { Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface UpvotePillProps extends Omit<PressableProps, "children" | "style"> {
  count: number;
  hasUpvoted: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}

export function UpvotePill({
  count,
  hasUpvoted,
  onPress,
  disabled = false,
  testID,
  style,
  ...rest
}: UpvotePillProps) {
  return (
    <Pressable
      {...rest}
      testID={testID}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={hasUpvoted ? "Remove upvote" : "Upvote"}
      accessibilityState={{ selected: hasUpvoted, disabled }}
      style={({ pressed }) => [
        styles.base,
        hasUpvoted ? styles.selected : styles.unselected,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Text style={[styles.glyph, hasUpvoted ? styles.glyphSelected : styles.glyphUnselected]}>
        ▲
      </Text>
      <View style={styles.divider} />
      <Text style={[styles.count, hasUpvoted ? styles.countSelected : styles.countUnselected]}>
        {count}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    minWidth: 56,
    minHeight: 36,
    justifyContent: "center",
  },
  unselected: {
    backgroundColor: tokens.bg.elevated,
    borderColor: tokens.border.default,
  },
  selected: {
    backgroundColor: tokens.accent.muted,
    borderColor: tokens.accent.default,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  divider: { width: 1, height: 14, backgroundColor: tokens.border.subtle },
  glyph: { fontSize: tokens.font.size.sm, lineHeight: tokens.font.size.md },
  glyphSelected: { color: tokens.accent.default },
  glyphUnselected: { color: tokens.text.secondary },
  count: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },
  countSelected: { color: tokens.accent.default },
  countUnselected: { color: tokens.text.primary },
});
