import { Pressable, type PressableProps, StyleSheet, View, type ViewStyle } from "react-native";
import { haptics } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { type PressState, webAria } from "./interaction";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface ChipProps extends Omit<PressableProps, "children" | "style"> {
  label: string;
  /** Optional leading icon (e.g. `plus` on "Save view"). */
  icon?: IconName;
  /** `danger` outlines the pill in `status.danger` (destructive chips). */
  tone?: "default" | "danger";
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}

/**
 * A 32pt pill inside a 44pt-tall press target: the pill keeps its quiet
 * size while the touch box meets the 44pt floor on web, where hitSlop does
 * nothing. Interactive chips are toggle buttons (`aria-pressed`).
 */
export function Chip({
  label,
  icon,
  tone = "default",
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
      onPress={
        !interactive || disabled
          ? undefined
          : () => {
              // Chips are toggles and pickers: a selection tick on every tap.
              haptics.selection();
              onPress?.();
            }
      }
      // A display-only chip is not a stop in the tab order.
      focusable={interactive}
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityState={{ selected, disabled }}
      aria-disabled={interactive ? disabled : undefined}
      {...webAria({ "aria-pressed": interactive ? selected : undefined })}
      style={[styles.target, style]}
    >
      {({ pressed, hovered }: PressState) => (
        <View
          style={[
            styles.pill,
            selected ? styles.selected : styles.unselected,
            tone === "danger" && !selected ? styles.danger : null,
            hovered && interactive && !disabled && !selected ? styles.hovered : null,
            pressed && interactive && !disabled ? styles.pressed : null,
            disabled ? styles.disabled : null,
          ]}
        >
          {icon ? (
            <Icon
              name={icon}
              size={14}
              tone={selected ? "accent" : tone === "danger" ? "danger" : "secondary"}
            />
          ) : selected ? (
            // Selected isn't only a color: amber vs grey is ~1.3:1 in
            // lightness, so a check marks it too (WCAG 1.4.1).
            <Icon name="check" size={12} tone="accent" />
          ) : null}
          <Text variant="label" style={selected ? styles.labelSelected : styles.labelUnselected}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minHeight: tokens.hit,
    minWidth: tokens.hit,
    justifyContent: "center",
    borderRadius: tokens.radius.pill,
  },
  pill: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    minHeight: 32,
    flexDirection: "row",
    gap: tokens.space.xsm,
    alignItems: "center",
    justifyContent: "center",
  },
  unselected: {
    backgroundColor: tokens.bg.elevated,
    // The outline is the chip's edge on canvas: `border.control` (≥3:1).
    borderColor: tokens.border.control,
  },
  hovered: { borderColor: tokens.text.muted },
  danger: { borderColor: tokens.status.danger },
  selected: {
    backgroundColor: tokens.accent.muted,
    borderColor: tokens.accent.default,
  },
  pressed: { backgroundColor: tokens.border.subtle },
  disabled: { opacity: 0.5 },
  labelSelected: { color: tokens.accent.default },
  labelUnselected: { color: tokens.text.secondary },
});
