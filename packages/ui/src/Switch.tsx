import { useEffect } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { interaction, type PressState } from "./interaction";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface SwitchProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  /** Row label. The whole row toggles. */
  label: string;
  /** Quiet second line under the label. */
  description?: string;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}

const TRACK_W = 40;
const TRACK_H = 24;
const KNOB = 20;

/**
 * A labelled on/off row (`role="switch"`, `aria-checked`). The whole row is
 * the target, so it clears 44pt with room to spare.
 */
export function Switch({
  value,
  onValueChange,
  label,
  description,
  disabled = false,
  testID,
  style,
}: SwitchProps) {
  const reduceMotion = useReducedMotion();
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.value = reduceMotion
      ? value
        ? 1
        : 0
      : withTiming(value ? 1 : 0, {
          duration: tokens.motion.fast,
          easing: Easing.bezier(...tokens.motion.easeOut),
        });
  }, [value, on, reduceMotion]);
  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: on.value * (TRACK_W - KNOB - 4) }],
  }));

  return (
    <Pressable
      role="switch"
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      aria-disabled={disabled}
      onPress={disabled ? undefined : () => onValueChange(!value)}
      testID={testID}
      style={({ pressed, hovered }: PressState) => [
        styles.row,
        value ? styles.rowOn : null,
        hovered && !disabled ? styles.hovered : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={styles.text}>
        <Text variant="label">{label}</Text>
        {description ? (
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        ) : null}
      </View>
      <View style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A quiet surface tile that takes the accent tint while on.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: tokens.hit + tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  rowOn: { backgroundColor: tokens.accent.muted },
  hovered: { backgroundColor: tokens.bg.elevated },
  pressed: { backgroundColor: interaction.pressed },
  disabled: { opacity: 0.5 },
  text: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    padding: 2,
    justifyContent: "center",
  },
  trackOff: { backgroundColor: tokens.border.subtle },
  trackOn: { backgroundColor: tokens.accent.default },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: tokens.text.primary,
  },
});
