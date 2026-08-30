import { StyleSheet, Text, View } from "react-native";
import { hs } from "../theme";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /** Sign-in screen renders the oversized variant; headers use the default. */
  size?: "md" | "lg";
}

// "HIGHSCORE" in Press Start 2P with the primary pink glow accent — one of
// the few designated glow elements (DESIGN.md brand assets). Press Start 2P
// has no lowercase and clips tight line boxes, so the caps + roomy explicit
// lineHeight are deliberate.
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <BrandIcon size={large ? 48 : 28} />
      <Text style={[styles.text, large ? styles.textLg : styles.textMd]} numberOfLines={1}>
        HIGHSCORE
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: hs.space.sm },
  text: {
    color: hs.color.textPrimary,
    fontFamily: hs.font.pixel,
    letterSpacing: 1,
    textShadowColor: hs.color.primaryGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  textMd: { fontSize: 14, lineHeight: 24 },
  textLg: { fontSize: 22, lineHeight: 36 },
});
