import {
  Image,
  type ImageStyle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface AvatarProps {
  /** Display name used to derive initials. Falls back to "?" when missing. */
  name: string | null;
  /**
   * Profile picture URI (a base64 `data:` URL or remote URL). When present it
   * renders over the initials circle; otherwise the deterministic
   * initials-on-color fallback shows.
   */
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
  style?: ViewStyle;
  testID?: string;
}

const SIZE: Record<NonNullable<AvatarProps["size"]>, number> = {
  sm: 24,
  md: 32,
  lg: 48,
};

const FONT_SIZE: Record<NonNullable<AvatarProps["size"]>, number> = {
  sm: tokens.font.size.xs,
  md: tokens.font.size.sm,
  lg: tokens.font.size.lg,
};

const PALETTE = [
  tokens.list.sunset,
  tokens.list.ocean,
  tokens.list.forest,
  tokens.list.grape,
  tokens.list.rose,
  tokens.list.sand,
  tokens.list.slate,
];

function initialsFor(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0]?.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

function colorFor(name: string | null): string {
  const seed = (name ?? "").split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return PALETTE[seed % PALETTE.length] ?? tokens.list.slate;
}

export function Avatar({ name, imageUrl, size = "md", style, testID }: AvatarProps) {
  const dim = SIZE[size];
  const circle: ViewStyle = { width: dim, height: dim, borderRadius: dim / 2 };

  if (imageUrl) {
    return (
      <Image
        testID={testID}
        source={{ uri: imageUrl }}
        accessibilityLabel={name ? `${name}'s profile picture` : "Profile picture"}
        // Callers pass a ViewStyle (width/height/borderRadius); the shared subset
        // is valid for an Image too.
        style={[styles.base, circle, styles.image, style] as StyleProp<ImageStyle>}
      />
    );
  }

  return (
    <View testID={testID} style={[styles.base, circle, { backgroundColor: colorFor(name) }, style]}>
      <Text tone="onAccent" style={[styles.label, { fontSize: FONT_SIZE[size] }]}>
        {initialsFor(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  image: { backgroundColor: tokens.bg.surface },
  label: { fontWeight: tokens.font.weight.semibold },
});
