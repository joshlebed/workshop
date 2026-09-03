// One (player × game) intersection. The atom both projections are built from:
// BY PLAYER lines cells up under a shared column of game marks, BY GAME lines
// them up in rank order under the game's name.
//
// Score marks are Press Start 2P, which is effectively monospace, so columns of
// `4/6` and `2:11` align without a table. A cell the day has no result for is a
// hollow bezel — an empty slot reads as "not yet", where a missing cell would
// just read as noise.
//
// Only an *outright* win is marked yellow, and only where position doesn't
// already say it: BY GAME sorts by rank, so the leftmost cell is the winner and
// a badge on top of that is decoration. Shared firsts — three people all
// solving Wordle in 4 — get nothing. Spotlight colour has to stay scarce.

import { memo } from "react";
import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import { PixelIcon, pixelType, tokens } from "../../theme";

export const CELL_WIDTH = 46;
export const CELL_HEIGHT = 34;
export const CELL_GAP = tokens.space.xs;

export interface ScoreCellProps {
  played: boolean;
  glyph: string | null;
  /** Sole #1 in that game. Ignored unless `markFirst`. */
  outrightFirst?: boolean;
  /** Off in BY GAME, where rank order already puts the winner first. */
  markFirst?: boolean;
  /** The viewer's own cell — filled rather than outlined. */
  isSelf?: boolean;
  accessibilityLabel: string;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
}

export const ScoreCell = memo(function ScoreCell({
  played,
  glyph,
  outrightFirst = false,
  markFirst = true,
  isSelf = false,
  accessibilityLabel,
  onPress,
  onLongPress,
  testID,
}: ScoreCellProps) {
  const win = markFirst && outrightFirst;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      testID={testID}
      style={({ pressed }) => [
        styles.cell,
        !played && styles.empty,
        isSelf && played && styles.self,
        win && styles.first,
        pressed && onPress && styles.pressed,
      ]}
    >
      {played ? (
        glyph ? (
          <RNText numberOfLines={1} style={win ? styles.glyphFirst : styles.glyph}>
            {glyph}
          </RNText>
        ) : (
          <PixelIcon name="check" size={12} color={tokens.text.secondary} />
        )
      ) : (
        <View style={styles.emptyMark} />
      )}
    </Pressable>
  );
});

const glyphBase = { ...pixelType(10, 1.4), letterSpacing: 0 };

const styles = StyleSheet.create({
  cell: {
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    // Filled, not outlined. A border on every cell is a spreadsheet; the only
    // outlined state in the grid is an outright win.
    borderWidth: tokens.bezel,
    borderColor: "transparent",
    backgroundColor: tokens.bg.surface,
  },
  self: { backgroundColor: tokens.bg.raised },
  empty: { backgroundColor: "transparent" },
  first: { borderColor: tokens.neon.yellow },
  pressed: { borderColor: tokens.neon.pink },
  glyph: { ...glyphBase, color: tokens.text.primary },
  glyphFirst: { ...glyphBase, color: tokens.neon.yellow },
  emptyMark: { width: 4, height: 4, backgroundColor: tokens.border.default },
});
