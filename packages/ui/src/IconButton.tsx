import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName, type IconTone } from "./Icon";
import { interaction, type PressState, webAria } from "./interaction";
import { tokens } from "./theme";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style"> {
  /** A named icon from `Icon`. Use `children` for anything custom. */
  icon?: IconName;
  iconTone?: IconTone;
  iconSize?: number;
  children?: React.ReactNode;
  accessibilityLabel: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Shows a spinner in place of the icon and sets `aria-busy`. */
  busy?: boolean;
  /** Toggle buttons: exposes `aria-pressed` on web. */
  toggled?: boolean;
  /**
   * Web hover tooltip (`title`). Defaults to the accessible name, so every
   * icon-only control says what it does on hover; pass a string to add a
   * shortcut ("New list  (N)").
   */
  tooltip?: string;
  style?: ViewStyle;
}

/** A 44×44 icon-only button with hover, pressed and focus-visible states. */
export function IconButton({
  icon,
  iconTone = "primary",
  iconSize = 20,
  children,
  accessibilityLabel,
  onPress,
  disabled = false,
  busy = false,
  toggled,
  tooltip,
  style,
  ...rest
}: IconButtonProps) {
  const inert = disabled || busy;
  return (
    <Pressable
      {...rest}
      onPress={inert ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inert, busy, selected: toggled }}
      aria-disabled={inert}
      aria-busy={busy}
      {...webAria({ "aria-pressed": toggled, title: tooltip ?? accessibilityLabel })}
      style={({ pressed, hovered }: PressState) => [
        styles.base,
        hovered && !inert ? styles.hovered : null,
        pressed && !inert ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={tokens.text.secondary}
          accessibilityLabel="Working"
        />
      ) : icon ? (
        <Icon name={icon} tone={iconTone} size={iconSize} />
      ) : (
        children
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: tokens.hit,
    height: tokens.hit,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  hovered: { backgroundColor: interaction.hover },
  pressed: { backgroundColor: interaction.pressed },
  disabled: { opacity: 0.4 },
});
