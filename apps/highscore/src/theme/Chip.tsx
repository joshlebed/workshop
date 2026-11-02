import { Pressable, type PressableProps, StyleSheet, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { tokens } from "./tokens";

export interface ChipProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}

/** Sharp-cornered chip: hairline bezel at rest, pink bezel + label when selected. */
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
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  unselected: {
    backgroundColor: "transparent",
    borderColor: tokens.border.default,
  },
  selected: {
    backgroundColor: tokens.accent.muted,
    borderColor: tokens.neon.pink,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  // Small pink text: use the tint so it doesn't read muddy at label size.
  labelSelected: { color: tokens.neon.pinkTint },
  labelUnselected: { color: tokens.text.secondary },
});
