// Horizontal day selector — "Today", "Yesterday", then older days back
// `length` days. Both leaderboard surfaces share it so "show me yesterday" is
// the same control whether you're on a single game's detail screen or the
// list-level status-card view.
//
// Controlled + pure presentation: the parent owns the active `selectedDate`
// and the data fetch keyed off it. Going past today isn't offered — daily
// puzzles have no future bucket.

import { Pressable, ScrollView, StyleSheet } from "react-native";
import { bezel, colors, font, glow, space, Text } from "../../theme";
import { shiftDateKey } from "../lib/gameDate";

const DEFAULT_LENGTH = 7;

export interface DayRailProps {
  /** Currently selected day, YYYY-MM-DD. */
  selectedDate: string;
  /** Today's key (YYYY-MM-DD) — the rail's right edge; it never goes past it. */
  today: string;
  onSelectDate: (key: string) => void;
  /** How many days the rail spans, today inclusive. Defaults to 7. */
  length?: number;
  /** testID prefix; each chip is `${testIDPrefix}-${dateKey}`. */
  testIDPrefix?: string;
  /** Edge padding so chips align with the host screen's content inset. */
  horizontalInset?: number;
}

export function DayRail({
  selectedDate,
  today,
  onSelectDate,
  length = DEFAULT_LENGTH,
  testIDPrefix = "day",
  horizontalInset = space.xl,
}: DayRailProps) {
  const days: { key: string; label: string }[] = [];
  for (let i = 0; i < length; i++) {
    const key = shiftDateKey(today, -i);
    days.push({ key, label: dayChipLabel(key, today) });
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.rail, { paddingHorizontal: horizontalInset }]}
    >
      {days.map((d) => {
        const selected = d.key === selectedDate;
        return (
          <Pressable
            key={d.key}
            accessibilityRole="button"
            accessibilityLabel={`Show ${d.label}`}
            accessibilityState={{ selected }}
            onPress={() => onSelectDate(d.key)}
            testID={`${testIDPrefix}-${d.key}`}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && styles.chipPressed,
            ]}
          >
            <Text variant="label" style={[styles.chipText, selected && styles.chipTextSelected]}>
              {d.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** "Today" / "Yesterday" / "Mon 5" for a YYYY-MM-DD key relative to today. */
function dayChipLabel(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === shiftDateKey(today, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

// Sharp bezeled day chips; the active day is the selection, so it gets pink
// plus the selection glow (one of the few designated glow elements).
const styles = StyleSheet.create({
  rail: {
    gap: space.sm,
  },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: 0,
    borderWidth: bezel,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  chipSelected: {
    backgroundColor: colors.surface2,
    borderColor: colors.primary,
    ...glow(colors.primaryGlow, 8),
  },
  chipPressed: { opacity: 0.75 },
  chipText: { fontSize: font.size.sm, color: colors.textSecondary },
  chipTextSelected: { color: colors.primary, fontWeight: font.weight.semibold },
});
