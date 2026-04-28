import { Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
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
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    if (disabled) return;
    scale.value = withSequence(
      withTiming(1.05, { duration: 90 }),
      withTiming(1, { duration: 120 }),
    );
    onPress?.();
  };

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        {...rest}
        testID={testID}
        onPress={handlePress}
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
    </Animated.View>
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
