// Month grid for days older than the strip. Future days are disabled; days
// with any activity in the viewer's circle carry a dot so you can see where
// the data is before you jump.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { IconButton, PixelIcon, Sheet, Text, tokens } from "../theme";
import { dayOfMonth, monthGrid, monthOf, monthTitle, shiftMonth } from "./spine";

interface MonthSheetProps {
  visible: boolean;
  selected: string;
  today: string;
  activeDays?: ReadonlySet<string>;
  onPick: (date: string) => void;
  onClose: () => void;
}

const WEEKDAYS = [
  ["mo", "M"],
  ["tu", "T"],
  ["we", "W"],
  ["th", "T"],
  ["fr", "F"],
  ["sa", "S"],
  ["su", "S"],
] as const;

export function MonthSheet({
  visible,
  selected,
  today,
  activeDays,
  onPick,
  onClose,
}: MonthSheetProps) {
  const [month, setMonth] = useState(monthOf(selected));
  // Re-centre on the selection every time the sheet opens.
  useEffect(() => {
    if (visible) setMonth(monthOf(selected));
  }, [visible, selected]);
  const cells = monthGrid(month);
  const atCurrentMonth = month >= monthOf(today);

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="month-sheet">
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Previous month"
          onPress={() => setMonth(shiftMonth(month, -1))}
        >
          <PixelIcon name="chevron-left" />
        </IconButton>
        <Text variant="heading" style={styles.title}>
          {monthTitle(month)}
        </Text>
        <IconButton
          accessibilityLabel="Next month"
          disabled={atCurrentMonth}
          onPress={() => setMonth(shiftMonth(month, 1))}
        >
          <PixelIcon name="chevron-right" />
        </IconButton>
      </View>
      <View style={styles.weekdays}>
        {WEEKDAYS.map(([key, w]) => (
          <Text key={key} variant="caption" tone="secondary" style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((date) => {
          if (monthOf(date) !== month) return <View key={date} style={styles.cell} />;
          const future = date > today;
          const isSelected = date === selected;
          const isToday = date === today;
          const active = activeDays?.has(date) ?? false;
          return (
            <Pressable
              key={date}
              testID={`month-day-${date}`}
              accessibilityRole="button"
              accessibilityState={{ disabled: future, selected: isSelected }}
              disabled={future}
              onPress={() => onPick(date)}
              style={({ pressed }) => [
                styles.cell,
                isSelected && styles.cellSelected,
                pressed && !future && styles.cellPressed,
              ]}
            >
              <Text
                variant="score"
                style={[
                  styles.day,
                  future && styles.dayFuture,
                  isToday && styles.dayToday,
                  isSelected && styles.daySelected,
                ]}
              >
                {dayOfMonth(date)}
              </Text>
              <View style={[styles.dot, active && !future && styles.dotActive]} />
            </Pressable>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        testID="month-today"
        onPress={() => onPick(today)}
        style={({ pressed }) => [styles.todayRow, pressed && styles.cellPressed]}
      >
        <Text variant="heading" tone="link" style={styles.todayLabel}>
          Jump to today
        </Text>
      </Pressable>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { flex: 1, textAlign: "center" },
  weekdays: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: tokens.bezel,
    borderColor: "transparent",
  },
  cellSelected: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  cellPressed: { backgroundColor: tokens.bg.raised },
  day: { fontSize: 11, lineHeight: 14 },
  dayFuture: { color: tokens.border.default },
  dayToday: { color: tokens.neon.yellow },
  daySelected: { color: tokens.neon.pink },
  dot: { width: 5, height: 5, backgroundColor: "transparent" },
  dotActive: { backgroundColor: tokens.text.secondary },
  todayRow: { alignItems: "center", paddingVertical: tokens.space.sm },
  todayLabel: { fontSize: 11, lineHeight: 16 },
});
