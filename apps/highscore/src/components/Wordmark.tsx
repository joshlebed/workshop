import { StyleSheet, Text, View } from "react-native";
import { PIXEL_FONT, tokens } from "../theme";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /** Sign-in screen renders the oversized variant; headers use the default. */
  size?: "md" | "lg";
}

/**
 * "HIGHSCORE" in Press Start 2P with the pink neon glow — per DESIGN.md the
 * wordmark is one of the few designated glow elements, and in the Neon
 * Signage variation it carries the strongest glow in the app.
 */
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
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  // Press Start 2P clips tight line boxes — lineHeight ~1.6× keeps the caps
  // clear of the top edge on iOS.
  text: {
    fontFamily: PIXEL_FONT,
    color: tokens.text.primary,
    letterSpacing: 1,
    textShadowColor: tokens.neon.pinkGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  textMd: { fontSize: 16, lineHeight: 26 },
  textLg: { fontSize: 24, lineHeight: 38 },
});
