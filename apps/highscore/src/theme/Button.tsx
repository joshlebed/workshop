import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  Text as RNText,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { glow, pixelType, tokens } from "./tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  /**
   * Render the label in Press Start 2P (DESIGN.md allows it on buttons at
   * ≥12px when the label is short). Use for one- or two-word arcade keys.
   */
  pixel?: boolean;
  leftIcon?: React.ReactNode;
  testID?: string;
  style?: ViewStyle;
}

/**
 * Lit-sign button: transparent fill, 2px bezel, lit label. Primary is the pink
 * sign — border + label in `primary` with `primary.glow`; it is the only
 * glowing variant.
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  pixel = false,
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
        sizeStyle[size],
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
          <RNText
            numberOfLines={1}
            style={[
              pixel ? pixelLabel : styles.label,
              { color: isDisabled ? tokens.text.secondary : labelColor[variant] },
            ]}
          >
            {label}
          </RNText>
        </>
      )}
    </Pressable>
  );
}

const glowStyle = glow(tokens.neon.pinkGlow);
const pixelLabel = pixelType(12, 1.4);

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
  label: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.semibold },
});

const sizeStyle: Record<Size, ViewStyle> = {
  sm: { paddingVertical: 6, paddingHorizontal: tokens.space.sm, minHeight: 32 },
  md: { paddingVertical: 10, paddingHorizontal: tokens.space.md, minHeight: 44 },
  lg: { paddingVertical: 14, paddingHorizontal: tokens.space.lg, minHeight: 52 },
};

const variantStyle: Record<Variant, ViewStyle> = {
  primary: { borderColor: tokens.neon.pink },
  secondary: { borderColor: tokens.border.default },
  ghost: { borderColor: "transparent" },
  danger: { borderColor: tokens.status.danger },
};

const pressedStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: tokens.accent.muted },
  secondary: { backgroundColor: tokens.bg.elevated },
  ghost: { backgroundColor: tokens.bg.elevated },
  danger: { backgroundColor: "rgba(255,77,94,0.12)" },
};

const labelColor: Record<Variant, string> = {
  primary: tokens.neon.pink,
  secondary: tokens.text.primary,
  ghost: tokens.text.primary,
  danger: tokens.status.danger,
};

// Disabled: kill the neon — plain purple bezel, secondary label, no glow.
const disabledStyle: Record<Variant, ViewStyle> = {
  primary: { borderColor: tokens.border.default },
  secondary: { borderColor: tokens.border.default },
  ghost: { borderColor: "transparent" },
  danger: { borderColor: tokens.border.default },
};
