import { Image, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { alpha, tokens } from "./theme";

export type EmojiBadgeSize = 24 | 44 | 72;

export interface EmojiBadgeProps {
  emoji: string;
  /** The list's hue (`tokens.list.*`); the badge fills with it at 20%. */
  color?: string;
  size?: EmojiBadgeSize;
  /** A cover photo replaces the emoji when present. */
  imageUrl?: string | null;
  /** Circle (lists, avatars) or a rounded square (item placeholders). */
  shape?: "circle" | "rounded";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const EMOJI_SIZE: Record<EmojiBadgeSize, number> = { 24: 13, 44: 22, 72: 36 };

/**
 * A list's identity mark: its emoji (or cover photo) on a 20% tint of the
 * list's own hue. The only place per-list color appears in chrome.
 * Decorative: the row or header beside it carries the name.
 */
export function EmojiBadge({
  emoji,
  color = tokens.accent.default,
  size = 44,
  imageUrl,
  shape = "circle",
  style,
  testID,
}: EmojiBadgeProps) {
  const radius = shape === "circle" ? size / 2 : size <= 24 ? tokens.radius.sm : tokens.radius.md;
  const box = { width: size, height: size, borderRadius: radius };
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.image, box, { borderColor: alpha(color, 0.2) }, style as object]}
        accessibilityIgnoresInvertColors
        accessibilityElementsHidden
        importantForAccessibility="no"
        testID={testID}
      />
    );
  }
  const glyph = EMOJI_SIZE[size];
  return (
    <View
      style={[styles.badge, box, { backgroundColor: alpha(color, 0.2) }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      <Text style={{ fontSize: glyph, lineHeight: Math.round(glyph * 1.2) }}>{emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: "center", justifyContent: "center" },
  image: { borderWidth: StyleSheet.hairlineWidth, backgroundColor: tokens.bg.elevated },
});
