import { Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";
import { BrandMark } from "./BrandMark";

interface WordmarkProps {
  /** Sign-in screen renders the oversized variant; headers use the default. */
  size?: "md" | "lg";
}

export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <BrandMark size={large ? 42 : 24} />
      <Text style={[styles.text, large ? styles.textLg : styles.textMd]}>HighScore</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  // lineHeight must be set explicitly: the shared <Text> defaults to the
  // `body` variant (lineHeight 22), so overriding only fontSize leaves a large
  // glyph in a 22px line box and iOS clips the ascenders.
  text: { color: tokens.text.primary, fontWeight: tokens.font.weight.bold },
  textMd: { fontSize: tokens.font.size.xl, lineHeight: 28, letterSpacing: -0.8 },
  textLg: { fontSize: 36, lineHeight: 44, letterSpacing: -1.4 },
});
