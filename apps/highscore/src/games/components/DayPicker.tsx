// Header day dropdown for the Games home: a compact "Today ▾" button that
// opens a sheet listing recent days (newest first). Replaces the horizontal
// day rail there; the per-game board keeps its rail.
//
// Controlled: the parent owns `selectedDate` and the fetch keyed off it.
// Future days aren't offered — daily puzzles have no future bucket.

import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { bodyType, PixelIcon, Sheet, Text, tokens } from "../../theme";
import { daysBack, formatGameDateLabel, shiftDateKey } from "../lib/gameDate";

/** Days offered by default, today inclusive. */
const DAY_PICKER_LENGTH = 14;

export interface DayPickerProps {
  /** Currently selected day, YYYY-MM-DD. */
  selectedDate: string;
  /** Today's key (YYYY-MM-DD) — the newest option. */
  today: string;
  onSelectDate: (key: string) => void;
  testID?: string;
}

/** "Today", "Yesterday", or "Tue, Nov 4". */
function optionLabel(key: string, today: string): string {
  const rel = formatGameDateLabel(key, today);
  if (rel === "Today" || rel === "Yesterday") return rel;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: dt.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function DayPicker({
  selectedDate,
  today,
  onSelectDate,
  testID = "games-day-picker",
}: DayPickerProps) {
  const [open, setOpen] = useState(false);
  // A board can select a day older than the default window; keep it listed.
  const length = Math.max(DAY_PICKER_LENGTH, daysBack(selectedDate, today) + 1);
  const days: string[] = [];
  for (let i = 0; i < length; i++) days.push(shiftDateKey(today, -i));
  const isToday = selectedDate === today;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Showing ${optionLabel(selectedDate, today)}. Change day`}
        onPress={() => setOpen(true)}
        hitSlop={6}
        testID={testID}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.button,
          !isToday && styles.buttonPast,
          (pressed || hovered) && styles.buttonHover,
        ]}
      >
        <Text style={[styles.buttonLabel, !isToday && styles.buttonLabelPast]} numberOfLines={1}>
          {formatGameDateLabel(selectedDate, today)}
        </Text>
        <PixelIcon
          name="chevron-down"
          size={16}
          color={isToday ? tokens.text.secondary : tokens.neon.pinkTint}
        />
      </Pressable>

      <Sheet visible={open} onRequestClose={() => setOpen(false)} testID={`${testID}-sheet`}>
        <Text variant="heading" style={styles.sheetTitle}>
          Show scores for
        </Text>
        <ScrollView style={styles.list}>
          {days.map((key) => {
            const selected = key === selectedDate;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  onSelectDate(key);
                  setOpen(false);
                }}
                testID={`${testID}-${key}`}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  (pressed || hovered) && styles.optionHover,
                ]}
              >
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {optionLabel(key, today)}
                </Text>
                {selected ? <View style={styles.dot} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 32,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  buttonPast: { borderColor: tokens.neon.pink },
  buttonHover: { backgroundColor: tokens.bg.elevated },
  buttonLabel: {
    ...bodyType("semibold"),
    fontSize: tokens.font.size.sm,
    color: tokens.text.secondary,
  },
  buttonLabelPast: { color: tokens.neon.pinkTint },
  sheetTitle: { marginBottom: tokens.space.sm },
  list: { maxHeight: 420 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.sm,
  },
  optionSelected: { backgroundColor: tokens.accent.muted },
  optionHover: { backgroundColor: tokens.bg.elevated },
  optionLabel: {
    ...bodyType(),
    fontSize: tokens.font.size.md,
    color: tokens.text.primary,
  },
  optionLabelSelected: { ...bodyType("semibold"), color: tokens.neon.pinkTint },
  dot: {
    width: 8,
    height: 8,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.neon.pink,
  },
});
