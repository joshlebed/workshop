import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "./Text";
import { tokens } from "./tokens";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  illustration?: React.ReactNode;
  hint?: React.ReactNode;
  /** Opt-in entrance animation; reduced-motion users always get static layout. */
  motion?: boolean;
  accessibilityLabel?: string;
}

export function EmptyState({
  title,
  description,
  action,
  illustration,
  hint,
  motion = false,
  accessibilityLabel,
}: EmptyStateProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(motion && !reduceMotion ? 0 : 1);

  useEffect(() => {
    if (!motion || reduceMotion) {
      progress.value = 1;
      return;
    }
    // Snappy, stepped-feeling ease-out — no springs, no overshoot.
    progress.value = withTiming(1, {
      duration: tokens.motion.base,
      easing: Easing.out(Easing.cubic),
    });
  }, [motion, reduceMotion, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));

  return (
    <Animated.View
      style={[styles.root, animatedStyle]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {illustration ? <View style={styles.illustration}>{illustration}</View> : null}
      <Text variant="heading" style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text tone="secondary" style={styles.description}>
          {description}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
      {hint ? <View style={styles.hint}>{hint}</View> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.md,
  },
  illustration: { marginBottom: tokens.space.xs },
  title: { textAlign: "center" },
  description: { textAlign: "center", maxWidth: 420 },
  action: { marginTop: tokens.space.lg },
  hint: { marginTop: tokens.space.sm },
});
