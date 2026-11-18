import { StyleSheet, View } from "react-native";
import { tokens } from "../../theme";

/** Head-to-head colours: a day you took, a tie, a day they took, a day nobody did. */
export const RECORD_COLOR = {
  win: tokens.neon.chartreuse,
  tie: tokens.text.secondary,
  loss: tokens.status.danger,
  none: tokens.border.default,
} as const;

/** Wins · ties · losses as one bar; an even grey track when nothing is decided. */
export function RecordBar({
  wins,
  ties,
  losses,
  height = 10,
}: {
  wins: number;
  ties: number;
  losses: number;
  height?: number;
}) {
  const segments = [
    { key: "win", flex: wins, color: RECORD_COLOR.win },
    { key: "tie", flex: ties, color: RECORD_COLOR.tie },
    { key: "loss", flex: losses, color: RECORD_COLOR.loss },
  ].filter((s) => s.flex > 0);
  return (
    <View style={[styles.bar, { height }]}>
      {segments.length === 0 ? (
        <View style={[styles.segment, { flex: 1, backgroundColor: RECORD_COLOR.none }]} />
      ) : (
        segments.map((s) => (
          <View key={s.key} style={[styles.segment, { flex: s.flex, backgroundColor: s.color }]} />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", gap: 2, borderRadius: tokens.radius.sm, overflow: "hidden" },
  segment: { minWidth: 4 },
});
