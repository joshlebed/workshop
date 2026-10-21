// Calendar picker behind the date bar's label: the last five weeks as a
// month-style grid. No future cells (daily games have no future bucket).
// Today is spotlight-yellow, the selected day gets the pink bezel.
//
// TODO(api): no per-day play counts yet — a `GET /v1/games/calendar?from=&to=`
// summary would let each cell show a dot for "something happened".

import { Pressable, StyleSheet, View } from "react-native";
import { Sheet, Text, tokens } from "../../theme";
import { recentDays } from "../lib/gameDate";

const WEEKS = 5;
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export interface DayPickerSheetProps {
  visible: boolean;
  selected: string;
  today: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}

function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();
}

function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .toUpperCase();
}

export function DayPickerSheet({
  visible,
  selected,
  today,
  onSelect,
  onClose,
}: DayPickerSheetProps) {
  // Exactly five rows: the trailing cells after today stay blank, and the
  // day count is chosen so the oldest day lands on a Sunday.
  const trailBlank = 6 - weekday(today);
  const days = recentDays(today, WEEKS * 7 - trailBlank);
  const oldest = days[0] ?? today;
  const cells: (string | null)[] = [...days, ...Array.from({ length: trailBlank }, () => null)];
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="day-picker-sheet">
      <View style={styles.header}>
        <Text variant="heading">PICK A DAY</Text>
        <Text variant="caption" tone="secondary">
          {monthLabel(oldest)}
          {monthLabel(oldest) === monthLabel(today) ? "" : ` – ${monthLabel(today)}`}
        </Text>
      </View>
      <View style={styles.weekdays}>
        {WEEKDAYS.map((w, i) => (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday header
            key={i}
            variant="caption"
            tone="secondary"
            style={styles.weekday}
          >
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {rows.map((row, r) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: calendar rows are positional
            key={r}
            style={styles.row}
          >
            {row.map((date, c) =>
              date ? (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityLabel={date}
                  accessibilityState={{ selected: date === selected }}
                  onPress={() => {
                    onSelect(date);
                    onClose();
                  }}
                  testID={`day-picker-${date}`}
                  style={({ pressed }) => [
                    styles.cell,
                    date === selected && styles.cellSelected,
                    pressed && styles.cellPressed,
                  ]}
                >
                  <Text
                    variant="score"
                    style={[
                      styles.cellText,
                      date === today && styles.cellTextToday,
                      date === selected && date !== today && styles.cellTextSelected,
                    ]}
                  >
                    {String(Number(date.slice(8, 10)))}
                  </Text>
                </Pressable>
              ) : (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: blank padding cells
                  key={`blank-${r}-${c}`}
                  style={styles.cell}
                />
              ),
            )}
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  weekdays: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", letterSpacing: 1 },
  grid: { gap: tokens.space.xs },
  row: { flexDirection: "row", gap: tokens.space.xs },
  cell: {
    flex: 1,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: "transparent",
  },
  cellSelected: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  cellPressed: { backgroundColor: tokens.bg.raised },
  cellText: { fontSize: 11, lineHeight: 16 },
  cellTextToday: { color: tokens.neon.yellow },
  cellTextSelected: { color: tokens.neon.pinkTint },
});
