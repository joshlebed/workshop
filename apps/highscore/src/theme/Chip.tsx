// HighScore Chip: shared Chip API, restyled — sharp corners, 2px bezel, pink
// selection (pink is the one interactive/selection color per DESIGN.md).

import { Pressable, type PressableProps, StyleSheet, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { bezel, colors, space } from "./tokens";

export interface ChipProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}

export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
  testID,
  style,
  ...rest
}: ChipProps) {
  const interactive = !!onPress;
  return (
    <Pressable
      {...rest}
      testID={testID}
      onPress={!interactive || disabled ? undefined : onPress}
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.unselected,
        pressed && interactive && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <Text variant="label" style={selected ? styles.labelSelected : styles.labelUnselected}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: 0,
    borderWidth: bezel,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  unselected: {
    backgroundColor: colors.surface2,
    borderColor: colors.border,
  },
  selected: {
    backgroundColor: colors.surface3,
    borderColor: colors.primary,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  labelSelected: { color: colors.primary },
  labelUnselected: { color: colors.textSecondary },
});
