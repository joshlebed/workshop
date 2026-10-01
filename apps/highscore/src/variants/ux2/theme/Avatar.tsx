import { useState } from "react";
import {
  Image,
  type ImageStyle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Text } from "./Text";
import { tokens } from "./tokens";

export interface AvatarProps {
  /** Display name used to derive initials. Falls back to "?" when missing. */
  name: string | null;
  imageUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE: Record<NonNullable<AvatarProps["size"]>, number> = {
  xs: 18,
  sm: 24,
  md: 32,
  lg: 48,
};

const FONT_SIZE: Record<NonNullable<AvatarProps["size"]>, number> = {
  xs: 8,
  sm: 10,
  md: tokens.font.size.xs,
  lg: tokens.font.size.md,
};

function initialsFor(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0]?.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** Pixel-era avatar: a sharp square with a 2px bezel — no circles here. */
export function Avatar({ name, imageUrl, size = "md", style, testID }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const dim = SIZE[size];
  const box: ViewStyle = { width: dim, height: dim };

  if (imageUrl && failedUrl !== imageUrl) {
    return (
      <Image
        testID={testID}
        source={{ uri: imageUrl }}
        accessibilityLabel={name ? `${name}'s profile picture` : "Profile picture"}
        onError={() => setFailedUrl(imageUrl)}
        style={[styles.base, box, styles.image, style] as StyleProp<ImageStyle>}
      />
    );
  }

  return (
    <View testID={testID} style={[styles.base, box, style]}>
      <Text style={[styles.label, { fontSize: FONT_SIZE[size] }]}>{initialsFor(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.raised,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: 0,
  },
  image: { backgroundColor: tokens.bg.surface },
  label: { fontWeight: tokens.font.weight.bold, color: tokens.text.secondary },
});
