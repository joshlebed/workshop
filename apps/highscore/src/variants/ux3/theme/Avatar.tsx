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
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE: Record<NonNullable<AvatarProps["size"]>, number> = {
  sm: 24,
  md: 32,
  lg: 48,
};

const FONT_SIZE: Record<NonNullable<AvatarProps["size"]>, number> = {
  sm: 10,
  md: tokens.font.size.xs,
  lg: tokens.font.size.md,
};

// Deterministic per-name initial color, drawn only from spec neons. These are
// small identity glyphs, not CTAs/success/spotlight semantics — same carve-out
// as the product's emoji.
const PALETTE = [
  tokens.neon.pinkTint,
  tokens.neon.chartreuse,
  tokens.neon.yellow,
  tokens.status.warning,
  tokens.text.primary,
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
  return PALETTE[seed % PALETTE.length] ?? tokens.text.primary;
}

/** Pixel-era avatar: a sharp square with a 2px bezel — no circles here. */
export function Avatar({ name, imageUrl, size = "md", style, testID }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const dim = SIZE[size];
  const box: ViewStyle = { width: dim, height: dim };

  // Initials are the base layer, not a fallback branch: a photo that is slow
  // (or 404s) then reads as an identity tile instead of an empty box.
  return (
    <View testID={testID} style={[styles.base, box, style]}>
      <Text style={[styles.label, { fontSize: FONT_SIZE[size], color: colorFor(name) }]}>
        {initialsFor(name)}
      </Text>
      {imageUrl && failedUrl !== imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          accessibilityLabel={name ? `${name}'s profile picture` : "Profile picture"}
          onError={() => setFailedUrl(imageUrl)}
          style={[StyleSheet.absoluteFill, styles.image] as StyleProp<ImageStyle>}
        />
      ) : null}
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
  image: { backgroundColor: tokens.bg.raised },
  label: { fontWeight: tokens.font.weight.bold },
});
