// Arcade marquee strip — the Marquee variation's section header: a lit
// `surface.3` bar with an ALL-CAPS Press Start 2P label in neon yellow
// (`accent` = the spotlight color, brand decoration per DESIGN.md).

import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { hs } from "./tokens";

export interface MarqueeHeaderProps {
  label: string;
  /** Optional right-aligned slot (counts, actions). */
  trailing?: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function MarqueeHeader({ label, trailing, style, testID }: MarqueeHeaderProps) {
  return (
    <View style={[styles.strip, style]} testID={testID}>
      <Text variant="pixel" tone="accent" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: hs.space.sm,
    backgroundColor: hs.color.surface3,
    borderWidth: hs.bezel,
    borderColor: hs.color.border,
    borderRadius: hs.radius,
    paddingHorizontal: hs.space.md,
    paddingVertical: hs.space.sm,
  },
  label: { flexShrink: 1 },
  trailing: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: hs.space.sm },
});
