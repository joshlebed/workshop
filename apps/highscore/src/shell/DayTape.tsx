// The day scrubber. It sits under the header, above the ledger, and never
// scrolls away: dragging it re-dates every row and the open board at once.
// Today is leftmost (the day you almost always want), older days run right.
//
// Marking rules from DESIGN.md: yellow spotlights *today*, pink marks *what
// you selected*. A day that is both gets a yellow numeral over a pink bar.

import { memo, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { shiftDateKey } from "../games/lib/gameDate";
import { glow, pixelType, tokens } from "../theme";
import { Text } from "../theme/Text";

const SPAN_DAYS = 14;
const CELL = 44;

export interface DayTapeProps {
  selectedDate: string;
  today: string;
  onSelectDate: (key: string) => void;
  /** Left inset so the tape's first cell lines up with the ledger's gutter. */
  horizontalInset: number;
}

function weekdayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
}

function dayNumber(key: string): string {
  const day = key.split("-")[2] ?? "";
  return String(Number(day));
}

export const DayTape = memo(function DayTape({
  selectedDate,
  today,
  onSelectDate,
  horizontalInset,
}: DayTapeProps) {
  const days = useMemo(
    () => Array.from({ length: SPAN_DAYS }, (_, i) => shiftDateKey(today, -i)),
    [today],
  );
  return (
    <View style={styles.host}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.tape, { paddingHorizontal: horizontalInset }]}
      >
        {days.map((key) => {
          const selected = key === selectedDate;
          const isToday = key === today;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={
                isToday ? "Show today" : `Show ${weekdayLabel(key)} ${dayNumber(key)}`
              }
              accessibilityState={{ selected }}
              onPress={() => onSelectDate(key)}
              testID={`games-day-${key}`}
              style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
            >
              <Text style={[styles.weekday, selected && styles.weekdaySelected]}>
                {weekdayLabel(key)}
              </Text>
              <Text
                style={[
                  styles.number,
                  isToday && styles.numberToday,
                  selected && !isToday && styles.numberSelected,
                ]}
              >
                {dayNumber(key)}
              </Text>
              <View style={[styles.bar, selected ? styles.barOn : null]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  host: {
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  tape: { gap: 0 },
  cell: {
    width: CELL,
    alignItems: "center",
    paddingTop: 8,
    gap: 3,
  },
  cellPressed: { opacity: 0.6 },
  weekday: {
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 1.2,
    color: tokens.text.secondary,
    opacity: 0.7,
  },
  weekdaySelected: { opacity: 1, color: tokens.text.primary },
  number: { ...pixelType(13), color: tokens.text.secondary, textAlign: "center" },
  numberSelected: { color: tokens.text.primary },
  numberToday: { color: tokens.neon.yellow },
  bar: {
    marginTop: 5,
    height: 2,
    width: CELL - 12,
    backgroundColor: "transparent",
  },
  barOn: { backgroundColor: tokens.neon.pink, ...glow(tokens.neon.pinkGlow, 8) },
});
