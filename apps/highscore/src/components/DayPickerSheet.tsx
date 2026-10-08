// Calendar sheet — "what happened on Tuesday?" in two taps from anywhere.
// One month at a time, future days disabled, today spotlighted in yellow,
// the viewed day lit in pink. No per-day activity dots: that needs an
// endpoint the API doesn't have yet (TODO — see UX-EXPLORATION.md).

import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { localDateKey } from "../games/lib/gameDate";
import { PixelIcon, Sheet, Text, tokens } from "../theme";

interface DayPickerSheetProps {
  visible: boolean;
  selectedDate: string;
  today: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthOf(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y ?? new Date().getFullYear(), month: (m ?? 1) - 1 };
}

export function DayPickerSheet({
  visible,
  selectedDate,
  today,
  onSelect,
  onClose,
}: DayPickerSheetProps) {
  const [cursor, setCursor] = useState(() => monthOf(selectedDate));
  const todayMonth = monthOf(today);
  const atCurrentMonth =
    cursor.year > todayMonth.year ||
    (cursor.year === todayMonth.year && cursor.month >= todayMonth.month);

  const first = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(localDateKey(new Date(cursor.year, cursor.month, d)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const step = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  };

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="day-picker-sheet">
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => step(-1)}
          hitSlop={8}
          style={styles.monthArrow}
        >
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </Pressable>
        <Text variant="heading" style={styles.monthLabel}>
          {MONTHS[cursor.month]} {cursor.year}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={atCurrentMonth ? undefined : () => step(1)}
          hitSlop={8}
          style={[styles.monthArrow, atCurrentMonth && styles.monthArrowDisabled]}
        >
          <PixelIcon name="chevron-right" size={24} color={tokens.text.primary} />
        </Pressable>
      </View>
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed 7-day header
          <Text key={i} variant="caption" tone="secondary" style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      {weeks.map((week, w) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional within a month
        <View key={w} style={styles.weekRow}>
          {week.map((key, i) => {
            if (!key) {
              // biome-ignore lint/suspicious/noArrayIndexKey: padding cells
              return <View key={`pad-${i}`} style={styles.day} />;
            }
            const future = key > today;
            const isToday = key === today;
            const selected = key === selectedDate;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={key}
                accessibilityState={{ selected, disabled: future }}
                onPress={future ? undefined : () => onSelect(key)}
                testID={`day-picker-${key}`}
                style={({ pressed }) => [
                  styles.day,
                  selected && styles.daySelected,
                  isToday && !selected && styles.dayToday,
                  pressed && !future && styles.dayPressed,
                ]}
              >
                <Text
                  variant="score"
                  tone={selected ? "link" : isToday ? "spotlight" : future ? "muted" : "primary"}
                  style={[styles.dayText, future && styles.dayTextFuture]}
                >
                  {Number(key.slice(8))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to today"
          onPress={() => onSelect(today)}
          style={({ pressed }) => [styles.todayBtn, pressed && styles.todayBtnPressed]}
          testID="day-picker-today"
        >
          <Text variant="heading" tone="link" style={styles.todayBtnText}>
            Today
          </Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthArrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  monthArrowDisabled: { opacity: 0.3 },
  monthLabel: { fontSize: 12, lineHeight: 20 },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", paddingVertical: tokens.space.xs },
  day: {
    flex: 1,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: "transparent",
  },
  daySelected: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  dayToday: { borderColor: tokens.neon.yellow },
  dayPressed: { backgroundColor: tokens.bg.raised },
  dayText: { fontSize: 11, lineHeight: 16, letterSpacing: 0 },
  dayTextFuture: { opacity: 0.3 },
  footer: { alignItems: "center", paddingTop: tokens.space.sm },
  todayBtn: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
  },
  todayBtnPressed: { backgroundColor: tokens.accent.muted },
  todayBtnText: { fontSize: 11, lineHeight: 18 },
});
