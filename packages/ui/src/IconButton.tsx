import { Pressable, type PressableProps, StyleSheet, type ViewStyle } from "react-native";
import { tokens } from "./theme";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style"> {
  children: React.ReactNode;
  accessibilityLabel: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  children,
  accessibilityLabel,
  onPress,
  disabled = false,
  style,
  ...rest
}: IconButtonProps) {
  return (
    <Pressable
      {...rest}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  pressed: { backgroundColor: tokens.bg.elevated },
  disabled: { opacity: 0.4 },
});
