import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { hs, hsGlow } from "./tokens";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

export interface HsButtonProps extends Omit<PressableProps, "children" | "style"> {
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
 * HighScore button. Sharp corners, 2px bezel. The primary variant is the one
 * glowing CTA on a screen (pink fill, dark label, neon glow) — everything
 * else stays quiet.
 */
export function HsButton({
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
}: HsButtonProps) {
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
        variant === "primary" && !isDisabled ? hsGlow(hs.color.primaryGlow) : null,
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
    borderRadius: hs.radius.hard,
    borderWidth: hs.bezel,
  },
  sizeMd: { paddingVertical: 10, paddingHorizontal: hs.space.lg, minHeight: 44 },
  sizeLg: { paddingVertical: 14, paddingHorizontal: hs.space.xl, minHeight: 52 },
  label: { fontSize: hs.font.size.md, fontWeight: hs.font.weight.semibold },
});

const variantStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: hs.color.primary, borderColor: hs.color.primary },
  secondary: { backgroundColor: hs.color.surface2, borderColor: hs.color.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: hs.color.surface1, borderColor: hs.color.danger },
};

const pressedStyle: Record<Variant, ViewStyle> = {
  primary: { opacity: 0.85 },
  secondary: { backgroundColor: hs.color.surface3 },
  ghost: { backgroundColor: hs.color.surface2 },
  danger: { backgroundColor: hs.color.surface2 },
};

const labelColor: Record<Variant, string> = {
  // Dark-on-neon reads as a lit sign; white-on-neon fails contrast.
  primary: hs.color.textOnNeon,
  secondary: hs.color.textPrimary,
  ghost: hs.color.primary,
  danger: hs.color.danger,
};

const disabledStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: hs.color.surface2, borderColor: hs.color.border },
  secondary: { backgroundColor: hs.color.surface1, borderColor: hs.color.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: hs.color.surface1, borderColor: hs.color.border },
};
