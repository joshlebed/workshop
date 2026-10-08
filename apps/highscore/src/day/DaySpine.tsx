// The day spine — HighScore's one global control. A 7-cell strip, a headline
// date line, step keys, and a `TODAY` key that appears the moment you leave
// today. Mounted on Home, the game board and profiles, all bound to the same
// `useViewDay()` value, so "I moved the app to Tuesday" is literally true.
import { haptics } from "@workshop/ui";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { localDateKey, shiftDateKey } from "../games/lib/gameDate";
import { useViewDay } from "../games/state/viewDay";
import { glow, IconButton, PixelIcon, Text, tokens } from "../theme";
import { MonthSheet } from "./MonthSheet";
import { dayOfMonth, spineLabel, spineWindow, weekdayInitial } from "./spine";

export interface DaySpineProps {
  /** Days the viewer posted a score on — a chartreuse dot under the cell. */
  playedDays?: ReadonlySet<string>;
  /** Days with any activity in the circle — marked in the month sheet. */
  activeDays?: ReadonlySet<string>;
  testIDPrefix?: string;
  /** Hide the headline row (profile prints its own "week ending" line). */
  compact?: boolean;
}

export function DaySpine({
  playedDays,
  activeDays,
  testIDPrefix = "day",
  compact = false,
}: DaySpineProps) {
  const { viewDate, setViewDate } = useViewDay();
  const today = localDateKey();
  const [monthOpen, setMonthOpen] = useState(false);
  const window = spineWindow(viewDate, today);
  const label = spineLabel(viewDate, today);
  const onToday = viewDate === today;

  const select = (date: string) => {
    if (date === viewDate) return;
    haptics.selection();
    setViewDate(date);
  };

  return (
    <View style={styles.root} testID={`${testIDPrefix}-spine`}>
      <View style={styles.strip}>
        {window.map((date) => {
          const selected = date === viewDate;
          const isToday = date === today;
          const played = playedDays?.has(date) ?? false;
          return (
            <Pressable
              key={date}
              testID={`${testIDPrefix}-${date}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={spineLabel(date, today).absolute}
              onPress={() => select(date)}
              style={({ pressed }) => [
                styles.cell,
                selected && styles.cellSelected,
                pressed && !selected && styles.cellPressed,
              ]}
            >
              <Text
                variant="caption"
                style={[styles.weekday, selected && styles.weekdaySelected]}
                numberOfLines={1}
              >
                {weekdayInitial(date)}
              </Text>
              <Text
                variant="score"
                style={[
                  styles.dayNumber,
                  isToday && !selected && styles.dayNumberToday,
                  selected && styles.dayNumberSelected,
                ]}
              >
                {dayOfMonth(date)}
              </Text>
              <View
                style={[
                  styles.dot,
                  played && styles.dotPlayed,
                  played && selected && styles.dotPlayedSelected,
                ]}
              />
            </Pressable>
          );
        })}
      </View>

      {compact ? null : (
        <View style={styles.headline}>
          <IconButton
            accessibilityLabel="Previous day"
            onPress={() => select(shiftDateKey(viewDate, -1))}
            testID={`${testIDPrefix}-prev`}
          >
            <PixelIcon name="chevron-left" size={24} />
          </IconButton>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pick a day"
            testID={`${testIDPrefix}-headline`}
            onPress={() => setMonthOpen(true)}
            style={({ pressed }) => [styles.headlineText, pressed && styles.cellPressed]}
          >
            <View style={styles.headlineStack}>
              <Text variant="heading" tone={onToday ? "spotlight" : "primary"} numberOfLines={1}>
                {label.relative ?? label.absolute}
              </Text>
              {label.relative ? (
                <Text
                  variant="caption"
                  tone="secondary"
                  numberOfLines={1}
                  style={styles.headlineSub}
                >
                  {label.absolute}
                </Text>
              ) : null}
            </View>
            <PixelIcon name="chevron-down" size={16} />
          </Pressable>
          {onToday ? (
            <IconButton
              accessibilityLabel="Next day"
              disabled
              onPress={() => {}}
              testID={`${testIDPrefix}-next`}
            >
              <PixelIcon name="chevron-right" size={24} />
            </IconButton>
          ) : (
            <>
              <IconButton
                accessibilityLabel="Next day"
                onPress={() => select(shiftDateKey(viewDate, 1))}
                testID={`${testIDPrefix}-next`}
              >
                <PixelIcon name="chevron-right" size={24} />
              </IconButton>
              <Pressable
                accessibilityRole="button"
                testID={`${testIDPrefix}-today`}
                onPress={() => select(today)}
                style={({ pressed }) => [styles.todayKey, pressed && styles.todayKeyPressed]}
              >
                <Text variant="heading" style={styles.todayLabel}>
                  Today
                </Text>
              </Pressable>
            </>
          )}
        </View>
      )}

      <MonthSheet
        visible={monthOpen}
        selected={viewDate}
        today={today}
        {...(activeDays ? { activeDays } : {})}
        onPick={(date) => {
          setMonthOpen(false);
          select(date);
        }}
        onClose={() => setMonthOpen(false)}
      />
    </View>
  );
}

const CELL_HEIGHT = 56;

const styles = StyleSheet.create({
  root: { gap: tokens.space.xs },
  strip: { flexDirection: "row", gap: 4 },
  cell: {
    flex: 1,
    height: CELL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: tokens.bezel,
    borderColor: "transparent",
    backgroundColor: tokens.bg.surface,
  },
  cellSelected: {
    borderColor: tokens.neon.pink,
    backgroundColor: tokens.accent.muted,
    ...glow(tokens.neon.pinkGlow, 8),
  },
  cellPressed: { backgroundColor: tokens.bg.elevated },
  weekday: {
    color: tokens.text.secondary,
    fontSize: 11,
    lineHeight: 13,
    textTransform: "uppercase",
  },
  weekdaySelected: { color: tokens.neon.pinkTint },
  dayNumber: { fontSize: 12, lineHeight: 16, color: tokens.text.primary },
  dayNumberToday: { color: tokens.neon.yellow },
  dayNumberSelected: { color: tokens.neon.pink },
  dot: { width: 6, height: 6, backgroundColor: "transparent" },
  dotPlayed: { backgroundColor: tokens.neon.chartreuse },
  dotPlayedSelected: { backgroundColor: tokens.neon.chartreuse },
  headline: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: 40,
  },
  headlineText: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 40,
    paddingHorizontal: tokens.space.xs,
  },
  headlineStack: { flexShrink: 1, minWidth: 0 },
  headlineSub: { letterSpacing: 1 },
  todayKey: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    height: 36,
    justifyContent: "center",
    ...glow(tokens.neon.pinkGlow, 8),
  },
  todayKeyPressed: { backgroundColor: tokens.accent.muted },
  todayLabel: { color: tokens.neon.pink, fontSize: 10, lineHeight: 14 },
});
