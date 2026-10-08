// The day is the document. Every scoreboard surface (home, game board,
// profile) pins this strip under its title bar: ‹ day › plus a TODAY chip
// that only appears once you've left today. One shared control over one
// shared piece of state (`state/viewDay`), so paging days on a game board and
// coming back to home never disagree about which day you are looking at.
//
// Tapping the date opens the calendar sheet (any past day); ‹ / › step one
// day; › is disabled on today — daily puzzles have no future bucket.

import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatDayHeading, localDateKey, shiftDateKey } from "../games/lib/gameDate";
import { useViewDay } from "../games/state/viewDay";
import { PixelIcon, Text, tokens } from "../theme";
import { DayPickerSheet } from "./DayPickerSheet";

export interface DayHeaderProps {
  /** Optional context line under the date ("13 games · 7 played"). */
  caption?: string | null;
  testIDPrefix?: string;
}

export function DayHeader({ caption = null, testIDPrefix = "day" }: DayHeaderProps) {
  const { viewDate, setViewDate } = useViewDay();
  const today = localDateKey();
  const isToday = viewDate === today;
  const [pickerOpen, setPickerOpen] = useState(false);
  const heading = formatDayHeading(viewDate, today);

  return (
    <View style={styles.root} testID={`${testIDPrefix}-header`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        onPress={() => setViewDate(shiftDateKey(viewDate, -1))}
        hitSlop={8}
        testID={`${testIDPrefix}-prev`}
        style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
      >
        <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Viewing ${heading.long}. Pick a day`}
        onPress={() => setPickerOpen(true)}
        testID={`${testIDPrefix}-date`}
        style={({ pressed }) => [styles.date, pressed && styles.datePressed]}
      >
        <Text
          variant="heading"
          tone={isToday ? "spotlight" : "primary"}
          style={styles.dateText}
          numberOfLines={1}
          testID={`${testIDPrefix}-label`}
        >
          {heading.short}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {caption ?? heading.long}
        </Text>
      </Pressable>

      {isToday ? (
        <View style={[styles.arrow, styles.arrowDisabled]} testID={`${testIDPrefix}-next`}>
          <PixelIcon name="chevron-right" size={24} color={tokens.text.secondary} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next day"
          onPress={() => setViewDate(shiftDateKey(viewDate, 1))}
          hitSlop={8}
          testID={`${testIDPrefix}-next`}
          style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
        >
          <PixelIcon name="chevron-right" size={24} color={tokens.text.primary} />
        </Pressable>
      )}

      {isToday ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to today"
          onPress={() => setViewDate(today)}
          testID={`${testIDPrefix}-today`}
          style={({ pressed }) => [styles.todayChip, pressed && styles.todayChipPressed]}
        >
          <Text variant="heading" tone="link" style={styles.todayText}>
            Today
          </Text>
        </Pressable>
      )}

      <DayPickerSheet
        visible={pickerOpen}
        selectedDate={viewDate}
        today={today}
        onSelect={(key) => {
          setViewDate(key);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
    gap: tokens.space.xs,
  },
  arrow: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowPressed: { backgroundColor: tokens.bg.elevated },
  arrowDisabled: { opacity: 0.35 },
  date: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xs,
    gap: 2,
  },
  datePressed: { backgroundColor: tokens.bg.elevated },
  dateText: { fontSize: 14, lineHeight: 22 },
  todayChip: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.sm,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginRight: tokens.space.xs,
  },
  todayChipPressed: { backgroundColor: tokens.accent.muted },
  todayText: { fontSize: 10, lineHeight: 16 },
});
