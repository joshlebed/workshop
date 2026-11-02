// Horizontal day selector — a timeline that reads left to right: older days
// on the left, "Yesterday", then "Today" at the right edge. The rail opens
// scrolled to the end (today in view) and going back in time scrolls left.
// Both leaderboard surfaces share it so "show me yesterday" is the same
// control whether you're on a single game's detail screen or the list-level
// status-card view.
//
// Controlled + pure presentation: the parent owns the active `selectedDate`
// and the data fetch keyed off it. Going past today isn't offered — daily
// puzzles have no future bucket.

import { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { scoreType, Text, tokens } from "../../theme";
import { shiftDateKey } from "../lib/gameDate";

/** Days the rail spans by default, today inclusive. */
export const DAY_RAIL_DEFAULT_LENGTH = 7;

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
  /**
   * When set, an "Earlier" chip leads the oldest day at the left edge; tapping
   * it asks the parent to grow `length`. Lets history-focused hosts page past
   * the default week without rendering an unbounded rail up front.
   */
  onExtend?: () => void;
}

export function DayRail({
  selectedDate,
  today,
  onSelectDate,
  length = DAY_RAIL_DEFAULT_LENGTH,
  testIDPrefix = "day",
  horizontalInset = tokens.space.xl,
  onExtend,
}: DayRailProps) {
  // Oldest first, today last — the chronological reading order.
  const days: { key: string; label: string; parts: DayChipParts }[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const key = shiftDateKey(today, -i);
    const parts = dayChipParts(key, today);
    days.push({ key, label: dayChipLabel(parts), parts });
  }
  const scrollRef = useRef<ScrollView>(null);
  // Open with today in view. Only on the first layout: when "Earlier" grows
  // the rail, the new chips appear at the left and the user is looking there.
  const scrolledToEndRef = useRef(false);
  const onContentSizeChange = () => {
    if (scrolledToEndRef.current) return;
    scrolledToEndRef.current = true;
    scrollRef.current?.scrollToEnd({ animated: false });
  };
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.rail, { paddingHorizontal: horizontalInset }]}
      onContentSizeChange={onContentSizeChange}
    >
      {onExtend ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show earlier days"
          onPress={onExtend}
          testID={`${testIDPrefix}-earlier`}
          style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
        >
          <Text variant="label" style={styles.chipText}>
            Earlier
          </Text>
        </Pressable>
      ) : null}
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
            <View style={styles.chipInner}>
              <Text
                variant={
                  d.parts.word === "Today" || d.parts.word === "Yesterday" ? "overline" : "label"
                }
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {d.parts.word}
              </Text>
              {d.parts.day ? (
                <Text variant="score" style={[styles.chipDay, selected && styles.chipTextSelected]}>
                  {d.parts.day}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

interface DayChipParts {
  /** "Today" / "Yesterday" / weekday word ("Mon"). Space Grotesk. */
  word: string;
  /** Day-of-month numeral for older days — set in the score (pixel) face. */
  day: string | null;
}

/** "Today" / "Yesterday" / ("Mon", "5") for a YYYY-MM-DD key relative to today. */
function dayChipParts(key: string, today: string): DayChipParts {
  if (key === today) return { word: "Today", day: null };
  if (key === shiftDateKey(today, -1)) return { word: "Yesterday", day: null };
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return { word: key, day: null };
  const dt = new Date(y, m - 1, d);
  return {
    word: dt.toLocaleDateString(undefined, { weekday: "short" }),
    day: dt.toLocaleDateString(undefined, { day: "numeric" }),
  };
}

/** "Today" / "Yesterday" / "Mon 5" — the chip's spoken label. */
function dayChipLabel(parts: DayChipParts): string {
  return parts.day ? `${parts.word} ${parts.day}` : parts.word;
}

const styles = StyleSheet.create({
  rail: {
    gap: tokens.space.sm,
  },
  chip: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: 6,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
    justifyContent: "center",
  },
  chipSelected: {
    backgroundColor: tokens.accent.muted,
    borderColor: tokens.neon.pink,
  },
  chipPressed: { opacity: 0.75 },
  chipInner: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  chipText: { color: tokens.text.secondary },
  chipDay: { ...scoreType(11), color: tokens.text.secondary },
  chipTextSelected: { color: tokens.neon.pink },
});
