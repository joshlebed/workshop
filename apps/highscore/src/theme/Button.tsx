// HighScore-owned Button: same API surface as the shared Button so call sites
// swap by import, restyled per DESIGN.md — sharp corners, 2px bezel, pink as
// the one interactive color, glow reserved for the primary variant.

import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { bezel, colors, font, glow, radius, space } from "./tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
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
}: ButtonProps) {
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
        variant === "primary" && !isDisabled ? glow(colors.primaryGlow) : null,
        pressed && !isDisabled ? pressedStyle[variant] : null,
        isDisabled && !loading ? disabledStyle[variant] : null,
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
              { color: isDisabled ? colors.textSecondary : labelColor[variant] },
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
    gap: space.sm,
    borderRadius: radius.soft,
    borderWidth: bezel,
  },
  sizeMd: { paddingVertical: 10, paddingHorizontal: space.lg, minHeight: 44 },
  sizeLg: { paddingVertical: 14, paddingHorizontal: space.xl, minHeight: 52 },
  label: { fontSize: font.size.md, fontWeight: font.weight.semibold },
});

const variantStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  secondary: { backgroundColor: colors.surface2, borderColor: colors.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: "transparent", borderColor: colors.danger },
};

const pressedStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.primaryTint, borderColor: colors.primaryTint },
  secondary: { backgroundColor: colors.surface3 },
  ghost: { backgroundColor: colors.surface2 },
  danger: { backgroundColor: `${colors.danger}1A` },
};

const labelColor: Record<Variant, string> = {
  primary: colors.textOnNeon,
  secondary: colors.textPrimary,
  ghost: colors.primary,
  danger: colors.danger,
};

const disabledStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: colors.surface2, borderColor: colors.border },
  secondary: { backgroundColor: colors.surface1, borderColor: colors.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: "transparent", borderColor: colors.border },
};
