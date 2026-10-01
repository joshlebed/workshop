import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { glow, pixelType, tokens } from "./tokens";

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

/**
 * Primary is the one filled control in the app: solid pink, dark label, pink
 * glow. Everything else is an outline. If a screen has two filled buttons, one
 * of them is wrong.
 *
 * Short labels are set in the pixel face at 12px so a button reads as part of
 * the same control panel as the dock; anything longer falls back to system
 * semibold, which is what DESIGN.md asks for.
 */
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
        variant === "primary" && !isDisabled ? glowStyle : null,
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
              label.length <= PIXEL_LABEL_MAX ? styles.pixelLabel : styles.label,
              { color: isDisabled ? tokens.text.secondary : labelColor[variant] },
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const glowStyle = glow(tokens.neon.pinkGlow);

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    backgroundColor: "transparent",
  },
  sizeMd: { paddingVertical: 10, paddingHorizontal: tokens.space.lg, minHeight: 44 },
  sizeLg: { paddingVertical: 14, paddingHorizontal: tokens.space.xl, minHeight: 52 },
  label: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.semibold },
  pixelLabel: { ...pixelType(12), fontSize: 12, lineHeight: 18 },
});

/** Longest label that still fits the pixel face without wrapping on a phone. */
const PIXEL_LABEL_MAX = 13;

const variantStyle: Record<Variant, ViewStyle> = {
  primary: { borderColor: tokens.neon.pink, backgroundColor: tokens.neon.pink },
  secondary: { borderColor: tokens.border.default },
  ghost: { borderColor: "transparent" },
  danger: { borderColor: tokens.status.danger },
};

const pressedStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: tokens.neon.pinkTint, borderColor: tokens.neon.pinkTint },
  secondary: { backgroundColor: tokens.bg.elevated },
  ghost: { backgroundColor: tokens.bg.elevated },
  danger: { backgroundColor: "rgba(255,77,94,0.12)" },
};

const labelColor: Record<Variant, string> = {
  primary: tokens.text.onAccent,
  secondary: tokens.text.primary,
  ghost: tokens.text.primary,
  danger: tokens.status.danger,
};

// Disabled: kill the neon — plain purple bezel, secondary label, no glow.
const disabledStyle: Record<Variant, ViewStyle> = {
  primary: { borderColor: tokens.border.default, backgroundColor: "transparent" },
  secondary: { borderColor: tokens.border.default },
  ghost: { borderColor: "transparent" },
  danger: { borderColor: tokens.border.default },
};
