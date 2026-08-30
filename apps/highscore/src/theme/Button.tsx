// HighScore button — same props API as @workshop/ui's Button so restyled
// call sites are drop-in swaps. Marquee treatment: sharp corners, 2px bezels,
// filled pink primary with dark-on-neon label and the reserved pink glow.

import type React from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { hs } from "./tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

export interface HSButtonProps extends Omit<PressableProps, "children" | "style"> {
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
}: HSButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...rest}
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === "lg" ? styles.sizeLg : styles.sizeMd,
        variantStyle[variant],
        pressed && !isDisabled ? pressedStyle[variant] : null,
        isDisabled ? disabledStyle[variant] : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor[variant]} />
      ) : (
        <>
          {leftIcon}
          <Text
            style={[
              styles.label,
              { color: isDisabled ? hs.color.textSecondary : labelColor[variant] },
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: hs.space.sm,
    borderRadius: hs.radius,
    borderWidth: hs.bezel,
  },
  sizeMd: { paddingVertical: 10, paddingHorizontal: hs.space.lg, minHeight: 44 },
  sizeLg: { paddingVertical: 14, paddingHorizontal: hs.space.xl, minHeight: 52 },
  label: { fontSize: hs.font.size.md, fontWeight: hs.font.weight.semibold },
});

const variantStyle: Record<Variant, ViewStyle> = {
  primary: {
    backgroundColor: hs.color.primary,
    borderColor: hs.color.primary,
    boxShadow: hs.glow.primary,
  },
  secondary: { backgroundColor: hs.color.surface2, borderColor: hs.color.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: hs.color.danger, borderColor: hs.color.danger },
};

const pressedStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: hs.color.primaryTint, borderColor: hs.color.primaryTint },
  secondary: { backgroundColor: hs.color.surface3 },
  ghost: { backgroundColor: hs.color.surface2 },
  danger: { opacity: 0.85 },
};

const labelColor: Record<Variant, string> = {
  primary: hs.color.textOnPrimary,
  secondary: hs.color.textPrimary,
  ghost: hs.color.textPrimary,
  danger: hs.color.textOnPrimary,
};

const disabledStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: hs.color.surface2, borderColor: hs.color.border, boxShadow: "none" },
  secondary: { backgroundColor: hs.color.surface1, borderColor: hs.color.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: hs.color.surface2, borderColor: hs.color.border },
};
