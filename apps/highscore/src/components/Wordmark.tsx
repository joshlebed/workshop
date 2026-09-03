import { StyleSheet, View } from "react-native";
import { Text, textGlow, tokens } from "../theme";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /** Sign-in and the shelf title render the oversized variant. */
  size?: "md" | "lg";
}

export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <BrandIcon size={large ? 40 : 22} />
      {/* The wordmark is one of the few things allowed to glow. */}
      <Text variant="title" style={[large ? styles.textLg : styles.textMd, styles.lit]}>
        HighScore
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  textMd: { fontSize: 13, lineHeight: 20 },
  textLg: { fontSize: 22, lineHeight: 34 },
  lit: textGlow(tokens.neon.pinkGlow, 10),
});
