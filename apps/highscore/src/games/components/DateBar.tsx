// The app's one time control. Pinned under the header of every day-aware
// surface (home, box score, profile) and bound to the shared `viewDay` state,
// so the day you are looking at is stated in the same place, in the same
// words, everywhere — and changing it anywhere changes it everywhere.
//
//   ‹   TODAY            ›        ‹   YESTERDAY   [TODAY]  ›
//       WED OCT 8                     TUE OCT 7
//
// Three ways to move: step with the chevrons, tap the label for the calendar
// picker, or tap the yellow TODAY chip (only shown off today) to snap back.
// The relative word is spotlight-yellow on today and plain on any other day,
// so "am I on today?" is answered by colour and by text at once.

import { Pressable, StyleSheet, View } from "react-native";
import { IconButton, PixelIcon, Text, tokens } from "../../theme";
import { dateBarLabel, shiftDateKey } from "../lib/gameDate";

export interface DateBarProps {
  date: string;
  today: string;
  onChange: (date: string) => void;
  onOpenPicker: () => void;
  testIDPrefix?: string;
}

export function DateBar({
  date,
  today,
  onChange,
  onOpenPicker,
  testIDPrefix = "date",
}: DateBarProps) {
  const isToday = date === today;
  const { relative, calendar } = dateBarLabel(date, today);
  return (
    <View style={styles.bar} testID={`${testIDPrefix}-bar`}>
      <IconButton
        accessibilityLabel="Previous day"
        onPress={() => onChange(shiftDateKey(date, -1))}
        testID={`${testIDPrefix}-prev`}
      >
        <PixelIcon name="chevron-left" color={tokens.text.primary} />
      </IconButton>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Viewing ${relative.toLowerCase()}, ${calendar}. Pick a day`}
        onPress={onOpenPicker}
        hitSlop={6}
        testID={`${testIDPrefix}-label`}
        style={({ pressed }) => [styles.label, pressed && styles.labelPressed]}
      >
        <Text
          variant="heading"
          tone={isToday ? "spotlight" : "primary"}
          numberOfLines={1}
          testID={`${testIDPrefix}-relative`}
        >
          {relative}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.calendar}>
          {calendar}
        </Text>
      </Pressable>

      {isToday ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to today"
          onPress={() => onChange(today)}
          hitSlop={6}
          testID={`${testIDPrefix}-today`}
          style={({ pressed }) => [styles.todayChip, pressed && styles.todayChipPressed]}
        >
          <Text style={styles.todayChipText}>TODAY</Text>
        </Pressable>
      )}

      <IconButton
        accessibilityLabel="Next day"
        onPress={() => onChange(shiftDateKey(date, 1))}
        disabled={isToday}
        testID={`${testIDPrefix}-next`}
      >
        <PixelIcon name="chevron-right" color={tokens.text.primary} />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
    gap: tokens.space.xs,
  },
  label: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
  },
  labelPressed: { opacity: 0.7 },
  calendar: { letterSpacing: 1, fontVariant: ["tabular-nums"] },
  todayChip: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.yellow,
    paddingHorizontal: tokens.space.sm,
    height: 28,
    justifyContent: "center",
  },
  todayChipPressed: { backgroundColor: "rgba(255,233,61,0.14)" },
  todayChipText: {
    fontFamily: tokens.font.pixel,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1,
    color: tokens.neon.yellow,
  },
});
