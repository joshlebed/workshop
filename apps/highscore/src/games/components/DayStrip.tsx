// A game's last seven days as a row of cells — the "team schedule" on the
// box score. Each cell is one day: weekday letter on top, your result (or
// your rank) underneath, "·" when you didn't play. Tapping a cell sets the
// shared view day, so the board below re-dates; the selected cell carries
// the pink bezel and today's letter is spotlight-yellow.

import { Pressable, StyleSheet, View } from "react-native";
import { Text, tokens } from "../../theme";

export interface DayStripCell {
  date: string;
  /** "M" / "T" … */
  weekday: string;
  /** Your short score for that day, null when you didn't play. */
  value: string | null;
  /** Something happened that day (anyone played) — dims the cell otherwise. */
  active: boolean;
  /** You placed first that day. */
  won: boolean;
}

export interface DayStripProps {
  cells: DayStripCell[];
  selected: string;
  today: string;
  onSelect: (date: string) => void;
  loading?: boolean;
  testIDPrefix?: string;
}

export function DayStrip({
  cells,
  selected,
  today,
  onSelect,
  loading,
  testIDPrefix = "strip",
}: DayStripProps) {
  return (
    <View style={styles.strip} testID={`${testIDPrefix}-strip`}>
      {cells.map((cell) => {
        const isSelected = cell.date === selected;
        const isToday = cell.date === today;
        return (
          <Pressable
            key={cell.date}
            accessibilityRole="button"
            accessibilityLabel={`${cell.date}${cell.value ? `, you got ${cell.value}` : ""}`}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(cell.date)}
            testID={`${testIDPrefix}-${cell.date}`}
            style={({ pressed }) => [
              styles.cell,
              isSelected && styles.cellSelected,
              pressed && styles.cellPressed,
            ]}
          >
            <Text style={[styles.weekday, isToday && styles.weekdayToday]} numberOfLines={1}>
              {cell.weekday}
            </Text>
            <Text
              style={[
                styles.value,
                !cell.value && styles.valueEmpty,
                cell.won && styles.valueWon,
                loading && styles.valueLoading,
              ]}
              numberOfLines={1}
            >
              {loading ? "·" : (cell.value ?? (cell.active ? "·" : " "))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    gap: tokens.space.xs,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  cellSelected: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  cellPressed: { backgroundColor: tokens.bg.raised },
  weekday: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1,
    color: tokens.text.secondary,
  },
  weekdayToday: { color: tokens.neon.yellow },
  value: {
    fontFamily: tokens.font.pixel,
    fontSize: 9,
    lineHeight: 14,
    color: tokens.text.primary,
  },
  valueEmpty: { color: tokens.text.secondary },
  valueWon: { color: tokens.neon.chartreuse },
  valueLoading: { opacity: 0.4 },
});
