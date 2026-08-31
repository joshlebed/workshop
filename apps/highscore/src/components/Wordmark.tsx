// "HIGHSCORE" in Press Start 2P with a pink neon glow — one of the few
// designated glow elements (DESIGN.md "Brand assets").

import { StyleSheet, View } from "react-native";
import { colors, font, Text } from "../theme";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /** Sign-in screen renders the oversized variant; headers use the default. */
  size?: "md" | "lg";
}

export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <BrandIcon size={large ? 48 : 28} />
      <Text style={[styles.text, large ? styles.textLg : styles.textMd]}>HIGHSCORE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  // Press Start 2P clips tight line boxes — lineHeight stays generous, and the
  // pink glow is textShadow (text-level neon), not a box shadow.
  text: {
    fontFamily: font.pixel,
    color: colors.textPrimary,
    textTransform: "uppercase",
    textShadowColor: colors.primaryGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  textMd: { fontSize: 14, lineHeight: 24, letterSpacing: 1 },
  textLg: { fontSize: 24, lineHeight: 40, letterSpacing: 1.5 },
});
