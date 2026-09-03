// The day scrubber — hidden chrome.
//
// Today is the answer 95% of the time, so the scrubber doesn't take permanent
// space: it lives just above the top of the home list and only appears when you
// scroll past it (or tap the date marker in the header). Selecting Today puts
// it away again.
//
// Seven keys, newest on the left. The day number is the whole label; the
// weekday is a caption. One highlight vocabulary, not two: the numeral is
// yellow on today (spotlight = what to look at) and pink on the day you picked
// (pink = what you acted on), and only the picked key gets a lit bezel.

import { Pressable, ScrollView, StyleSheet } from "react-native";
import { Text } from "../../theme/Text";
import { glow, tokens } from "../../theme/tokens";
import { shiftDateKey } from "../lib/gameDate";

/** Height the host must reserve above its list content. */
export const SCRUBBER_HEIGHT = 66;

const DEFAULT_LENGTH = 7;

export interface DayScrubberProps {
  selectedDate: string;
  today: string;
  onSelectDate: (key: string) => void;
  length?: number;
  testIDPrefix?: string;
}

export function DayScrubber({
  selectedDate,
  today,
  onSelectDate,
  length = DEFAULT_LENGTH,
  testIDPrefix = "games-day",
}: DayScrubberProps) {
  const days: { key: string; day: string; weekday: string }[] = [];
  for (let i = 0; i < length; i++) {
    const key = shiftDateKey(today, -i);
    days.push({ key, ...dayParts(key) });
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      testID="games-day-scrubber"
    >
      {days.map((d) => {
        const selected = d.key === selectedDate;
        const isToday = d.key === today;
        return (
          <Pressable
            key={d.key}
            accessibilityRole="button"
            accessibilityLabel={`Show ${isToday ? "today" : `${d.weekday} ${d.day}`}`}
            accessibilityState={{ selected }}
            onPress={() => onSelectDate(d.key)}
            testID={`${testIDPrefix}-${d.key}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.key,
              selected && styles.keySelected,
              selected && glow(tokens.neon.pinkGlow, 8),
              (pressed || hovered) && !selected && styles.keyActive,
            ]}
          >
            <Text
              variant="score"
              tone={selected ? "link" : isToday ? "spotlight" : "secondary"}
              style={styles.day}
              allowFontScaling={false}
            >
              {d.day}
            </Text>
            <Text variant="caption" tone="secondary" style={styles.weekday}>
              {d.weekday}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** "Today" / "Yesterday" / "Wed 2" for a YYYY-MM-DD key relative to today. */
export function dayMarkerLabel(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === shiftDateKey(today, -1)) return "Yesterday";
  const { weekday, day } = dayParts(key);
  return `${weekday} ${day}`;
}

function dayParts(key: string): { day: string; weekday: string } {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return { day: "--", weekday: "" };
  const dt = new Date(y, m - 1, d);
  return {
    day: String(d),
    weekday: dt.toLocaleDateString(undefined, { weekday: "short" }),
  };
}

const styles = StyleSheet.create({
  rail: {
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    alignItems: "center",
  },
  key: {
    width: 44,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  keySelected: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  keyActive: { backgroundColor: tokens.bg.raised },
  day: { fontSize: 12, lineHeight: 16 },
  weekday: { fontSize: 10, lineHeight: 12, textTransform: "uppercase", letterSpacing: 0.5 },
});
