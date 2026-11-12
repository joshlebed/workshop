import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { Icon, type IconName } from "./Icon";
import type { PressState } from "./interaction";
import { useOptionalToast } from "./Toast";
import { tokens } from "./theme";

export interface FabProps {
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  icon?: IconName;
  /** Web tooltip (`title`), e.g. a keyboard shortcut. */
  tooltip?: string;
  testID?: string;
  style?: ViewStyle;
}

const SIZE = 56;
const INSET = tokens.space.lg;

/**
 * The floating primary action: bottom-right, 56pt accent disc with a
 * neutral drop shadow (never an accent glow). While mounted it lifts the
 * toast viewport above itself so toasts stop covering it.
 */
export function Fab({
  accessibilityLabel,
  accessibilityHint,
  onPress,
  icon = "plus",
  tooltip,
  testID,
  style,
}: FabProps) {
  const toast = useOptionalToast();
  const registerBottomInset = toast?.registerBottomInset;
  useEffect(() => registerBottomInset?.(SIZE + INSET), [registerBottomInset]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      // @ts-expect-error: react-native-web threads `title` through to <button title>
      title={Platform.OS === "web" ? tooltip : undefined}
      testID={testID}
      style={({ pressed, hovered }: PressState) => [
        styles.fab,
        hovered && styles.hovered,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Icon name={icon} size={24} tone="onAccent" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: INSET,
    bottom: INSET,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    // Calm neutral elevation, not an amber glow: the accent fill carries the
    // warmth (DESIGN.md).
    boxShadow: "0px 10px 24px rgba(0, 0, 0, 0.45), 0px 2px 6px rgba(0, 0, 0, 0.30)",
    elevation: 6,
  },
  hovered: { backgroundColor: tokens.accent.hover },
  pressed: { backgroundColor: tokens.accent.hover, transform: [{ scale: 0.96 }] },
});
