// The day control. A stepper, not a rail: a daily-games app is a "today"
// app, and a scrolling week of chips spends a whole band of the screen
// insisting otherwise. Two chevrons and the day itself. Off today the label
// turns pink — the one interactive color — and taking it back to today is one
// tap, so you can never get lost in the past.

import { Pressable, Text as RNText, StyleSheet, View } from "react-native";
import { formatGameDateLabel, shiftDateKey } from "../games/lib/gameDate";

/** "Sep 3" — the label for a screen that already says which day is today. */
function formatAbsoluteDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

import { IconKey, pixelType, tokens } from "../theme";

interface DateStepperProps {
  date: string;
  today: string;
  onChange: (dateKey: string) => void;
  /** How far back stepping is allowed, in days. */
  maxBackDays?: number;
  /**
   * Always show the calendar date, never "Today". Detail screens already carry
   * a `‹ Today` back key, and one screen saying "today" twice is one too many.
   */
  absolute?: boolean;
  testID?: string;
}

const DEFAULT_MAX_BACK = 30;

export function DateStepper({
  date,
  today,
  onChange,
  maxBackDays = DEFAULT_MAX_BACK,
  absolute = false,
  testID = "date-stepper",
}: DateStepperProps) {
  const isToday = date === today;
  const earliest = shiftDateKey(today, -maxBackDays);
  const canGoBack = date > earliest;
  const label = absolute ? formatAbsoluteDate(date) : formatGameDateLabel(date, today);

  return (
    <View style={styles.row} testID={testID}>
      <IconKey
        icon="chevron-left"
        size={16}
        accessibilityLabel="Previous day"
        disabled={!canGoBack}
        onPress={() => onChange(shiftDateKey(date, -1))}
        testID={`${testID}-prev`}
      />
      <Pressable
        accessibilityRole={isToday ? "text" : "button"}
        accessibilityLabel={isToday ? label : `${label}. Back to today`}
        disabled={isToday}
        onPress={() => onChange(today)}
        hitSlop={6}
        testID={`${testID}-label`}
        style={({ pressed }) => [styles.labelBox, pressed && styles.labelPressed]}
      >
        <RNText numberOfLines={1} style={[styles.label, !isToday && styles.labelPast]}>
          {label}
        </RNText>
      </Pressable>
      <IconKey
        icon="chevron-right"
        size={16}
        accessibilityLabel="Next day"
        disabled={isToday}
        onPress={() => onChange(shiftDateKey(date, 1))}
        testID={`${testID}-next`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  labelBox: {
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xs,
  },
  labelPressed: { backgroundColor: tokens.bg.elevated },
  label: { ...pixelType(13, 1.5), color: tokens.text.primary },
  labelPast: { color: tokens.neon.pink },
});
