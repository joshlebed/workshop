// "HIGHSCORE" wordmark — Press Start 2P, primary text with a neon-pink glow
// accent (one of the few designated glow elements per DESIGN.md).

import { StyleSheet, View } from "react-native";
import { HsText, hsColor, hsSpace } from "../theme";
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
      <HsText variant="pixelHeading" style={[styles.text, large ? styles.textLg : styles.textMd]}>
        HIGHSCORE
      </HsText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: hsSpace.sm },
  // Press Start 2P clips tight line boxes — keep lineHeight generous (~1.6×).
  text: {
    color: hsColor.textPrimary,
    textShadowColor: hsColor.primaryGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  textMd: { fontSize: 14, lineHeight: 23 },
  textLg: { fontSize: 22, lineHeight: 36 },
});
