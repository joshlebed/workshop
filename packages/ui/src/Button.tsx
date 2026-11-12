import type { Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  View,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import { interaction, type PressState } from "./interaction";
import { tokens } from "./theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "children" | "style" | "ref"> {
  ref?: Ref<ViewInstance>;
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  testID?: string;
  style?: ViewStyle;
}

export function Button({
  ref,
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  leftIcon,
  testID,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...rest}
      ref={ref}
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      // react-native-web drops `accessibilityState`; aria-* reaches the DOM.
      aria-disabled={isDisabled}
      aria-busy={loading}
      // The label stays announced while a spinner replaces it.
      accessibilityLabel={rest.accessibilityLabel ?? label}
      style={({ pressed, hovered }: PressState) => [
        styles.base,
        size === "lg" ? styles.sizeLg : styles.sizeMd,
        variantStyle[variant],
        hovered && !pressed && !isDisabled ? hoverStyle[variant] : null,
        pressed && !isDisabled ? pressedStyle[variant] : null,
        // Disabled state: instead of opacity-on-everything (which muddies the
        // accent fill and dims the label below readable contrast), neutralise
        // the fill and switch the label to a muted-but-legible secondary tone.
        isDisabled && !loading ? disabledStyle[variant] : null,
        style,
      ]}
    >
      {/* The label keeps its place (invisible) while the spinner sits over
          it, so the button never changes width between the two. */}
      <View style={[styles.content, loading && styles.contentHidden]}>
        {leftIcon}
        <Text
          style={[
            styles.label,
            {
              color: isDisabled && !loading ? disabledLabelColor[variant] : labelColor[variant],
            },
          ]}
        >
          {label}
        </Text>
      </View>
      {loading ? (
        <View style={styles.spinner} pointerEvents="none">
          <ActivityIndicator color={labelColor[variant]} accessibilityLabel={label} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
  },
  // 44pt on every platform: web ignores hitSlop, so the box itself is the target.
  // The min heights set the box; the padding only matters once a label
  // wraps or the user's text size grows.
  sizeMd: {
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    minHeight: tokens.hit,
    minWidth: tokens.hit,
  },
  sizeLg: {
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.xl,
    minHeight: tokens.hit + tokens.space.sm,
  },
  label: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.semibold },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
  },
  contentHidden: { opacity: 0 },
  spinner: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});

const variantStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: tokens.accent.default, borderColor: tokens.accent.default },
  secondary: { backgroundColor: tokens.bg.elevated, borderColor: tokens.border.control },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: tokens.status.danger, borderColor: tokens.status.danger },
};

const hoverStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: tokens.accent.hover, borderColor: tokens.accent.hover },
  secondary: { backgroundColor: tokens.border.subtle },
  ghost: { backgroundColor: interaction.hover },
  danger: { opacity: 0.92 },
};

// Pressed is a background step (secondary steps down, ghost picks up the
// accent tint), never an opacity fade on the label.
const pressedStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: tokens.accent.hover, borderColor: tokens.accent.hover },
  secondary: { backgroundColor: tokens.bg.surface },
  ghost: { backgroundColor: tokens.accent.muted },
  danger: { opacity: 0.85 },
};

const labelColor: Record<Variant, string> = {
  primary: tokens.text.onAccent,
  secondary: tokens.text.primary,
  ghost: tokens.text.primary,
  // Dark label on the danger red: the light label measured 3.06:1, under AA.
  danger: tokens.text.onAccent,
};

const disabledStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: tokens.bg.elevated, borderColor: tokens.border.subtle },
  secondary: { backgroundColor: tokens.bg.surface, borderColor: tokens.border.subtle },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: tokens.bg.elevated, borderColor: tokens.border.subtle },
};

const disabledLabelColor: Record<Variant, string> = {
  primary: tokens.text.muted,
  secondary: tokens.text.muted,
  ghost: tokens.text.muted,
  danger: tokens.text.muted,
};
