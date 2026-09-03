// A player's whole day, game by game — what the peek shows when you hold a
// player row, and what their profile shows in full.

import { StyleSheet, View } from "react-native";
import { Text, tokens } from "../../../theme";
import { GameCover } from "../../components/GameCover";
import type { PlayerCell } from "../../lib/matrix";

interface PlayerDayProps {
  cells: PlayerCell[];
  /** Icon per gameId, so the peek can show the same marks as the matrix. */
  icons: Map<string, string | null>;
  viewingToday: boolean;
  /** Peek mode: only what they actually posted, plus a count of what they didn't. */
  playedOnly?: boolean;
}

export function PlayerDay({ cells, icons, viewingToday, playedOnly = false }: PlayerDayProps) {
  const shown = playedOnly ? cells.filter((c) => c.played) : cells;
  const skipped = cells.length - shown.length;
  return (
    <View style={styles.list}>
      {shown.map((cell) => (
        <View key={cell.gameId} style={styles.row}>
          <GameCover iconUrl={icons.get(cell.gameId) ?? null} size={22} dim={!cell.played} />
          <Text
            variant="label"
            numberOfLines={1}
            style={cell.played ? styles.title : styles.titleQuiet}
          >
            {cell.gameTitle}
          </Text>
          {cell.played ? (
            <Text variant="mono" numberOfLines={1} style={styles.body}>
              {cell.body ?? "played"}
            </Text>
          ) : (
            <Text variant="caption" tone="secondary" style={styles.body}>
              {viewingToday ? "not yet" : "—"}
            </Text>
          )}
          <Text variant="cell" style={cell.outrightFirst ? styles.markFirst : styles.mark}>
            {cell.glyph ?? (cell.played ? "·" : "")}
          </Text>
        </View>
      ))}
      {skipped > 0 ? (
        <Text variant="caption" tone="secondary" style={styles.skipped}>
          {viewingToday ? `${skipped} not played yet` : `${skipped} not played`}
        </Text>
      ) : null}
      {shown.length === 0 ? (
        <Text variant="caption" tone="secondary">
          {viewingToday ? "Nothing posted yet today." : "Nothing posted that day."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: tokens.space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
  },
  title: { width: 92, color: tokens.text.primary },
  titleQuiet: { width: 92, color: tokens.text.secondary },
  body: { flex: 1, minWidth: 0, color: tokens.text.secondary, textAlign: "right" },
  mark: { minWidth: 40, textAlign: "right", color: tokens.text.primary, letterSpacing: 0 },
  markFirst: { minWidth: 40, textAlign: "right", color: tokens.neon.yellow, letterSpacing: 0 },
  skipped: { paddingTop: tokens.space.xs },
});
