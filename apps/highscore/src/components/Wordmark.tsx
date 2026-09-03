import { StyleSheet, View } from "react-native";
import { pixelType, textGlow, tokens } from "../theme";
import { Text } from "../theme/Text";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /**
   * `md` — the ledger header, cabinet and type on one line.
   * `lg` — sign-in: the cabinet at scale with the type beneath it.
   */
  size?: "md" | "lg";
}

/**
 * "HIGHSCORE" as a lit sign — Press Start 2P in `text.primary` over a pink
 * glow. The glow is one of the few DESIGN.md-designated elements allowed one.
 */
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel="HighScore"
      style={large ? styles.stack : styles.row}
    >
      <View style={large ? styles.iconWrapLg : styles.iconWrap}>
        <BrandIcon size={large ? 88 : 22} />
      </View>
      <Text style={[large ? styles.textLg : styles.textMd, styles.glow]}>HIGHSCORE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  stack: { alignItems: "flex-start", gap: tokens.space.md },
  iconWrap: { width: 22, height: 22 },
  iconWrapLg: { width: 88, height: 88 },
  textMd: { ...pixelType(13), color: tokens.text.primary },
  textLg: { ...pixelType(22), color: tokens.text.primary },
  glow: textGlow(tokens.neon.pinkGlow, 8),
});
