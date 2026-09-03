import { StyleSheet, View } from "react-native";
import { Text } from "../theme/Text";
import { textGlow, tokens } from "../theme/tokens";

interface WordmarkProps {
  /** Sign-in renders the oversized variant; the home header uses the default. */
  size?: "md" | "lg";
}

/**
 * "HIGHSCORE" in Press Start 2P with a pink glow — one of the few elements
 * DESIGN.md lets glow. No lockup mark beside it: the wordmark is the mark.
 */
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="HighScore" style={styles.row}>
      <Text variant="title" style={[large ? styles.lg : styles.md, glowText]}>
        HighScore
      </Text>
    </View>
  );
}

const glowText = textGlow(tokens.neon.pinkGlow, 10);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  md: { fontSize: 14, lineHeight: 22 },
  lg: { fontSize: 22, lineHeight: 36 },
});
