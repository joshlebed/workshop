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
import { tokens } from "./theme";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /**
   * Optional visual above the title. Use this to carry list-specific
   * identity (per-list color halo + emoji) into an otherwise neutral
   * empty surface. Stays out of the absolute-bans territory: no card,
   * no glassmorphism, no decorative gradient.
   */
  illustration?: React.ReactNode;
  /**
   * Optional supporting affordance below the action: a keyboard-shortcut
   * chip, a "press / to search" hint, etc. Renders muted/quiet by default.
   */
  hint?: React.ReactNode;
  /**
   * Opt-in entrance animation. Off by default because some EmptyState
   * uses (filter-empty) re-render on every keystroke and would flicker.
   * Reduced-motion users get the static layout regardless.
   */
  motion?: boolean;
  /** Optional override for AT announcement; defaults to `title`. */
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
    progress.value = withTiming(1, {
      duration: 360,
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
