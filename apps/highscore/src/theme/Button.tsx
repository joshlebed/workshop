import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { glow, tokens } from "./tokens";

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
 * Neon-sign button ("Neon Signage" v2): transparent fill, 2px bezel, lit
 * label. Primary is the pink sign — border + label in `primary` with
 * `primary.glow`; it is the only glowing variant.
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
        isDisabled && !loading ? disabledStyle : null,
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
});

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

// Disabled: kill the neon and drop the whole control back. An outlined
// purple bezel alone was indistinguishable from the enabled `secondary`
// variant, so an outlined button meant two opposite things.
const disabledStyle: ViewStyle = {
  borderColor: tokens.border.default,
  borderStyle: "dashed",
  opacity: 0.5,
};
