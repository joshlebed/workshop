import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { tokens } from "./theme";

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
        pressed && !isDisabled ? pressedStyle[variant] : null,
        // Disabled state: instead of opacity-on-everything (which muddies the
        // accent fill and dims the label below readable contrast), neutralise
        // the fill and switch the label to a muted-but-legible secondary tone.
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
              { color: isDisabled ? disabledLabelColor[variant] : labelColor[variant] },
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
    gap: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
  },
  sizeMd: { paddingVertical: 10, paddingHorizontal: tokens.space.lg, minHeight: 44 },
  sizeLg: { paddingVertical: 14, paddingHorizontal: tokens.space.xl, minHeight: 52 },
  label: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.semibold },
});

const variantStyle: Record<Variant, ViewStyle> = {
  primary: { backgroundColor: tokens.accent.default, borderColor: tokens.accent.default },
  secondary: { backgroundColor: tokens.bg.elevated, borderColor: tokens.border.default },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: tokens.status.danger, borderColor: tokens.status.danger },
};

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
  danger: tokens.text.primary,
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
