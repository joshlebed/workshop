import { Text, tokens } from "@workshop/ui";
import { StyleSheet, View } from "react-native";

interface WordmarkProps {
  /** Sign-in screen renders the oversized variant; headers use the default. */
  size?: "md" | "lg";
}

// "high·Score" wordmark. Mirrors Workshop's "workshop·dev" treatment (accent
// dot between the two halves) so the two apps read as siblings.
export function Wordmark({ size = "md" }: WordmarkProps) {
  const large = size === "lg";
  const type = large ? styles.textLg : styles.textMd;
  const dot = large ? styles.dotLg : styles.dotMd;
  return (
    <View style={styles.row}>
      <Text style={[type, styles.lead]}>high</Text>
      <View style={[styles.dot, dot]} />
      <Text style={[type, styles.trail]}>score</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  // lineHeight must be set explicitly: the shared <Text> defaults to the
  // `body` variant (lineHeight 22), so overriding only fontSize leaves a large
  // glyph in a 22px line box and iOS clips the ascenders.
  textMd: { fontSize: tokens.font.size.xl, lineHeight: 28, letterSpacing: -0.6 },
  textLg: { fontSize: 34, lineHeight: 42, letterSpacing: -1 },
  lead: { color: tokens.text.muted, fontWeight: tokens.font.weight.regular },
  trail: { color: tokens.text.primary, fontWeight: tokens.font.weight.semibold },
  dot: { borderRadius: 999, backgroundColor: tokens.accent.default },
  dotMd: { width: 6, height: 6, transform: [{ translateY: -2 }] },
  dotLg: { width: 8, height: 8, transform: [{ translateY: -3 }] },
});
