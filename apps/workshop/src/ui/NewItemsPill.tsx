import { useMemo } from "react";
import { Pressable, type PressableProps, StyleSheet, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { useTheme } from "./useTheme";

export interface NewItemsPillProps extends Omit<PressableProps, "children" | "style"> {
  count: number;
  onPress: () => void;
  testID?: string;
  style?: ViewStyle;
}

export function NewItemsPill({ count, onPress, testID, style, ...rest }: NewItemsPillProps) {
  const t = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          alignSelf: "center",
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.sm,
          borderRadius: t.radius.pill,
          backgroundColor: t.accent.default,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        },
        pressed: { opacity: 0.85 },
        label: {
          fontSize: t.font.size.sm,
          fontWeight: t.font.weight.semibold,
          color: t.text.onAccent,
        },
      }),
    [t],
  );
  const label = `${count} new ${count === 1 ? "item" : "items"} — tap to refresh`;
  return (
    <Pressable
      {...rest}
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.base, pressed && styles.pressed, style]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
