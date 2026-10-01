import { StyleSheet, View } from "react-native";
import { Text, textGlow, tokens } from "../theme";
import { BrandIcon } from "./BrandIcon";

interface WordmarkProps {
  /** Sign-in screen renders the oversized variant with the cabinet mark. */
  size?: "md" | "lg";
}

/**
 * "HIGHSCORE" set in Press Start 2P with a pink glow — one of the few elements
 * in the app allowed to glow at all (DESIGN.md). The header variant drops the
 * app icon: the icon is already the thing you tapped to get here, so repeating
 * it beside the name is decoration.
 */
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      {large ? <BrandIcon size={56} /> : null}
      <Text
        variant={large ? "display" : "heading"}
        style={[large ? styles.lg : styles.md, textGlow(tokens.neon.pinkGlow, large ? 14 : 9)]}
      >
        HighScore
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  md: { letterSpacing: 1.5 },
  lg: { letterSpacing: 2 },
});
