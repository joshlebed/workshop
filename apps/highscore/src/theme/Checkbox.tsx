import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { PixelIcon } from "./PixelIcon";
import { Text } from "./Text";
import { tokens } from "./tokens";

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label beside the box; omit for a bare box (pass `accessibilityLabel`). */
  label?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}

/**
 * Square checkbox in the `Chip` idiom: 2px bezel, 2px radius, hairline border
 * at rest, pink bezel + pink fill with a dark pixel check when ticked.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  accessibilityLabel,
  disabled = false,
  testID,
  style,
}: CheckboxProps) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : () => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      aria-checked={checked}
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={[styles.box, checked ? styles.boxChecked : styles.boxUnchecked]}>
        {checked ? <PixelIcon name="check" size={16} color={tokens.text.onAccent} /> : null}
      </View>
      {label ? (
        <Text variant="label" tone={checked ? "primary" : "secondary"}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  box: {
    width: 22,
    height: 22,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    alignItems: "center",
    justifyContent: "center",
  },
  boxUnchecked: { borderColor: tokens.border.default, backgroundColor: "transparent" },
  boxChecked: { borderColor: tokens.neon.pink, backgroundColor: tokens.neon.pink },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
