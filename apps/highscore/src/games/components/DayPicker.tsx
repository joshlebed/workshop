// Header day picker: a pixel calendar icon (pink while a past day is showing)
// that opens a sheet listing recent days (newest first). Used by the Games home
// and the per-game board (both share the selected day via state/viewDay).
//
// Controlled: the parent owns `selectedDate` and the fetch keyed off it.
// Future days aren't offered — daily puzzles have no future bucket.

import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { bodyType, PixelIcon, Sheet, Text, tokens } from "../../theme";
import { daysBack, formatGameDateLabel, shiftDateKey } from "../lib/gameDate";

/** Days offered by default, today inclusive. */
export const DAY_PICKER_LENGTH = 30;

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
        hitSlop={8}
        testID={testID}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.button,
          (pressed || hovered) && styles.buttonHover,
        ]}
      >
        <PixelIcon
          name="calendar"
          size={24}
          color={isToday ? tokens.text.secondary : tokens.neon.pink}
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
  // Same 40×40 icon button as the header's copy / friends controls.
  button: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  buttonHover: { backgroundColor: tokens.bg.elevated },
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
