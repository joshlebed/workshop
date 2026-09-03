import { Pressable, type PressableProps, StyleSheet, type ViewStyle } from "react-native";
import { PixelIcon, type PixelIconName } from "./PixelIcon";
import { tokens } from "./tokens";

export interface IconKeyProps extends Omit<PressableProps, "children" | "style"> {
  icon: PixelIconName;
  accessibilityLabel: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Pink when the key is the active/selected one; secondary at rest. */
  active?: boolean;
  size?: 16 | 24;
  style?: ViewStyle;
}

/**
 * A bare pixel-icon key. No bezel at rest — chrome affordances (back, close,
 * date steps) shouldn't carry the same weight as a bezelled action button.
 */
export function IconKey({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  active = false,
  size = 24,
  style,
  ...rest
}: IconKeyProps) {
  return (
    <Pressable
      {...rest}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <PixelIcon
        name={icon}
        size={size}
        color={active ? tokens.neon.pink : tokens.text.secondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
  },
  pressed: { backgroundColor: tokens.bg.elevated },
  disabled: { opacity: 0.3 },
});
