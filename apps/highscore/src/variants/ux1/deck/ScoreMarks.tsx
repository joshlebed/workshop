// A game's grid, drawn as palette squares instead of the provider's emoji.
// Emoji in a pixel face render at the wrong weight and break line boxes; a
// row of 2px-bezel-free squares is crisper, on-palette, and the same width
// every time, which is what makes a column of scores line up.

import { StyleSheet, View } from "react-native";
import type { MarkKind } from "../games/lib/scoreMarks";
import { tokens } from "../theme";

const COLORS: Record<MarkKind, string> = {
  hit: tokens.neon.chartreuse,
  near: tokens.neon.yellow,
  warm: tokens.status.warning,
  miss: tokens.status.danger,
  alt: tokens.text.secondary,
  blank: tokens.bg.raised,
};

interface ScoreMarksProps {
  marks: MarkKind[];
  /** 6 in a standings row, 8 on a friend's profile card. */
  size?: number;
}

export function ScoreMarks({ marks, size = 6 }: ScoreMarksProps) {
  if (marks.length === 0) return null;
  return (
    <View style={styles.row}>
      {marks.map((kind, i) => (
        <View
          // Positional cells — index is the identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional cells
          key={i}
          style={{ width: size, height: size, backgroundColor: COLORS[kind] }}
        />
      ))}
    </View>
  );
}

export function ScoreGrid({ grid, size = 6 }: { grid: MarkKind[][]; size?: number }) {
  if (grid.length === 0) return null;
  return (
    <View style={styles.grid}>
      {grid.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
        <ScoreMarks key={i} marks={row} size={size} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 2 },
  grid: { gap: 2 },
});
