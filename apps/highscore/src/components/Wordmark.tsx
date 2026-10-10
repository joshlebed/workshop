import { StyleSheet, View } from "react-native";
import { Text, textGlow, tokens } from "../theme";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /** Sign-in screen renders the oversized variant; headers use the default. */
  size?: "md" | "lg";
}

/** "HIGHSCORE" in Press Start 2P with the pink glow — DESIGN.md brand asset. */
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <BrandIcon size={large ? 56 : 28} />
      <Text variant="display" style={[styles.text, large ? styles.textLg : styles.textMd]}>
        HighScore
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  text: { color: tokens.text.primary, ...textGlow(tokens.neon.pinkGlow, 8) },
  textMd: { fontSize: 14, lineHeight: 22 },
  textLg: { fontSize: 24, lineHeight: 38 },
});
