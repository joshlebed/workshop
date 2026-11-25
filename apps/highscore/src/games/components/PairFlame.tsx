// The pair-flame (spike #10): "🔥5" for a friend streak of `STREAK_MIN_DAYS`+
// consecutive days you both posted. Same glyph and pixel numeral as the
// per-game "· 🔥N" on a home card, minus the dot. Renders nothing below the
// threshold, so callers can pass any streak.

import type { FriendStreak } from "@workshop/shared/games";
import { StyleSheet, View } from "react-native";
import { scoreType, Text, tokens } from "../../theme";
import { pairFlame } from "../lib/friendStreaks";

export function PairFlame({
  streak,
  testID,
  size = "sm",
}: {
  streak: FriendStreak | null | undefined;
  testID?: string;
  size?: "sm" | "md";
}) {
  const days = pairFlame(streak);
  if (days === null) return null;
  const md = size === "md";
  return (
    <View style={styles.flame} accessibilityLabel={`${days} day streak together`} testID={testID}>
      {/* Emoji pins an explicit lineHeight ≥ fontSize — iOS clips it otherwise. */}
      <Text style={md ? styles.glyphMd : styles.glyph}>🔥</Text>
      <Text style={md ? styles.countMd : styles.count}>{days}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flame: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 2 },
  glyph: { fontSize: 13, lineHeight: 18 },
  count: { ...scoreType(10), lineHeight: 18, color: tokens.neon.yellow },
  glyphMd: { fontSize: 18, lineHeight: 24 },
  countMd: { ...scoreType(14), lineHeight: 24, color: tokens.neon.yellow },
});
