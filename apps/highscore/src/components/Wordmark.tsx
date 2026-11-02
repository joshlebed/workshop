import { StyleSheet, View } from "react-native";
import { Text, textGlow, tokens } from "../theme";
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
      <Text variant="display" style={[styles.text, large ? styles.textLg : styles.textMd]}>
        HighScore
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  // The HIGHSCORE wordmark: Press Start 2P (`display`) with the pink glow —
  // one of the few designated glows (DESIGN.md). lineHeight is set explicitly
  // because the pixel face clips tight line boxes.
  text: { color: tokens.text.primary, ...textGlow(tokens.neon.pinkGlow, 8) },
  textMd: { fontSize: 14, lineHeight: 22 },
  textLg: { fontSize: 24, lineHeight: 38 },
});
