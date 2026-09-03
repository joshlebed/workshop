// Day navigation inside the game-board sheet.
//
// The gesture is a horizontal swipe across the board; this is the visible half
// of it — two tap targets and a stepped indicator, so the swipe is a shortcut
// rather than the only way through (web pointers and assistive tech get the
// same reach). The indicator is a fixed seven-day window ending today: the
// rightmost pip is today, and travelling further back than a week drops the
// pips and says how far back you are instead.

import { Pressable, StyleSheet, View } from "react-native";
import { shiftDateKey } from "../games/lib/gameDate";
import { PixelIcon, Text, tokens } from "../theme";

const WINDOW = 7;
const PIPS = [0, 1, 2, 3, 4, 5, 6];

export function dayOffset(date: string, today: string): number {
  let offset = 0;
  let cursor = today;
  while (offset < 400) {
    if (cursor === date) return offset;
    cursor = shiftDateKey(cursor, -1);
    offset += 1;
  }
  return offset;
}

export interface DayPagerProps {
  date: string;
  today: string;
  label: string;
  sublabel: string;
  onPrev: () => void;
  onNext: () => void;
  /** Jump straight to a day in the visible week — the pips are a scrubber. */
  onJump: (daysBack: number) => void;
}

export function DayPager({ date, today, label, sublabel, onPrev, onNext, onJump }: DayPagerProps) {
  const offset = dayOffset(date, today);
  const atToday = offset === 0;
  const inWindow = offset < WINDOW;

  return (
    <View style={styles.root} testID="board-day-pager">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous day"
        onPress={onPrev}
        hitSlop={10}
        testID="board-day-prev"
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.arrow,
          (pressed || hovered) && styles.arrowActive,
        ]}
      >
        <PixelIcon name="chevron-left" size={16} color={tokens.text.secondary} />
      </Pressable>

      <View style={styles.center}>
        <View style={styles.labelRow}>
          <Text variant="heading" tone={atToday ? "spotlight" : "primary"} testID="board-day-label">
            {label}
          </Text>
          <Text variant="eyebrow" tone="muted">
            {sublabel}
          </Text>
        </View>
        <View style={styles.pips}>
          {inWindow ? (
            PIPS.map((index) => {
              const back = WINDOW - 1 - index;
              return (
                <Pressable
                  key={index}
                  accessibilityRole="button"
                  accessibilityLabel={
                    back === 0 ? "Today" : back === 1 ? "Yesterday" : `${back} days ago`
                  }
                  onPress={() => onJump(back)}
                  hitSlop={{ top: 12, bottom: 12, left: 3, right: 3 }}
                  testID={`board-day-pip-${back}`}
                >
                  <View style={[styles.pip, back === offset && styles.pipOn]} />
                </Pressable>
              );
            })
          ) : (
            <Text variant="eyebrow" tone="muted">
              −{offset} days
            </Text>
          )}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next day"
        onPress={onNext}
        disabled={atToday}
        hitSlop={10}
        testID="board-day-next"
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.arrow,
          !atToday && (pressed || hovered) && styles.arrowActive,
          atToday && styles.arrowOff,
        ]}
      >
        <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.md,
  },
  arrow: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  arrowActive: { backgroundColor: tokens.bg.raised },
  arrowOff: { opacity: 0.25 },
  center: { alignItems: "center", gap: tokens.space.xs },
  labelRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  pips: { flexDirection: "row", gap: 5, height: 8, alignItems: "center" },
  pip: { width: 8, height: 3, backgroundColor: tokens.border.default },
  pipOn: { backgroundColor: tokens.neon.pink, height: 8 },
});
