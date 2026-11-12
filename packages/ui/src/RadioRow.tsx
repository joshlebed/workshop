import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { haptics } from "./haptics";
import { interaction, type PressState, webSpaceKey } from "./interaction";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface RadioRowProps {
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** Trailing content (a spinner while the choice saves). */
  trailing?: ReactNode;
  testID?: string;
  style?: ViewStyle;
}

/**
 * One option of a single-choice group (`role="radio"`, `aria-checked`).
 * Wrap a set in `<View role="radiogroup" aria-label=…>`.
 */
export function RadioRow({
  label,
  description,
  selected,
  onSelect,
  disabled = false,
  trailing,
  testID,
  style,
}: RadioRowProps) {
  const choose = disabled
    ? undefined
    : () => {
        // A selection tick when the choice changes, none on a re-tap.
        if (!selected) haptics.selection();
        onSelect();
      };
  return (
    <Pressable
      role="radio"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      aria-disabled={disabled}
      onPress={choose}
      {...webSpaceKey(choose)}
      testID={testID}
      style={({ pressed, hovered }: PressState) => [
        styles.row,
        selected ? styles.rowSelected : null,
        hovered && !disabled && !selected ? styles.hovered : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      <View style={[styles.ring, selected ? styles.ringOn : null]}>
        {selected ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.text}>
        <Text variant="label">{label}</Text>
        {description ? (
          // On the accent tint `muted` drops under 4.5:1; `secondary` clears it.
          <Text variant="caption" tone={selected ? "secondary" : "muted"}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.md,
    minHeight: tokens.hit + tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
  },
  rowSelected: { borderColor: tokens.accent.default, backgroundColor: tokens.accent.muted },
  hovered: { backgroundColor: interaction.hover },
  pressed: { backgroundColor: interaction.pressed },
  disabled: { opacity: 0.5 },
  ring: {
    width: 18,
    height: 18,
    borderRadius: tokens.radius.pill,
    borderWidth: 1.5,
    borderColor: tokens.border.control,
    alignItems: "center",
    justifyContent: "center",
    marginTop: tokens.space.xxs,
  },
  ringOn: { borderColor: tokens.accent.default },
  dot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.accent.default,
  },
  text: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
});
