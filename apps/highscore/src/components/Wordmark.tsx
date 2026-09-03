import { StyleSheet, View } from "react-native";
import { pixelType, textGlow, tokens } from "../theme";
import { Text } from "../theme/Text";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /** Sign-in renders the oversized variant; the ledger header uses the default. */
  size?: "md" | "lg";
}

/**
 * "HIGHSCORE" as a lit sign — Press Start 2P in `text.primary` over a pink
 * glow. The glow is one of the few DESIGN.md-designated elements allowed one.
 */
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <View style={[styles.iconWrap, large && styles.iconWrapLg]}>
        <BrandIcon size={large ? 44 : 22} />
      </View>
      <Text style={[large ? styles.textLg : styles.textMd, styles.glow]}>HIGHSCORE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  iconWrap: { width: 22, height: 22 },
  iconWrapLg: { width: 44, height: 44 },
  textMd: { ...pixelType(13), color: tokens.text.primary },
  textLg: { ...pixelType(22), color: tokens.text.primary },
  glow: textGlow(tokens.neon.pinkGlow, 8),
});
