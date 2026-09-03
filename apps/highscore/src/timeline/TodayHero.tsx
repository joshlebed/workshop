// TODAY — the top of the feed and the only part of the app that tells you what
// to do next.
//
// One number (how many of your games you've posted), one list (the ones you
// haven't), one wrap-up action (copy the day's recap). Games you *have* posted
// are not repeated here — they show up in the day's standings below with
// everyone else's, which is the only place their score is worth reading.

import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { PixelIcon, Text, textGlow, tokens } from "../theme";
import { dayHeading } from "./dayLabels";
import { SpineTick } from "./Spine";

export interface TodayHeroProps {
  today: string;
  postedCount: number;
  totalCount: number;
  /** Rendered games list — the platform-split reorderable list. */
  games: ReactNode;
  canCopyRecap: boolean;
  copyingRecap: boolean;
  onCopyRecap: () => void;
}

export function TodayHero({
  today,
  postedCount,
  totalCount,
  games,
  canCopyRecap,
  copyingRecap,
  onCopyRecap,
}: TodayHeroProps) {
  const heading = dayHeading(today, today);
  const allClear = totalCount > 0 && postedCount === totalCount;

  return (
    <View testID="today-hero">
      <View style={styles.header}>
        <SpineTick tone="today" />
        <Text variant="heading" tone="spotlight">
          {heading.label}
        </Text>
        <Text variant="eyebrow" tone="muted" style={styles.date}>
          {heading.date}
        </Text>
        <View style={styles.rule} />
      </View>

      <View style={styles.body}>
        <View style={styles.statRow}>
          {/* One typographic unit, not a numeral with a floating denominator:
              same size, same baseline, the count carries the colour. */}
          <Text
            variant="hero"
            tone="muted"
            style={allClear ? textGlow(tokens.neon.chartreuseGlow, 12) : undefined}
            testID="today-posted-count"
          >
            <Text variant="hero" tone={postedCount > 0 ? "success" : "secondary"}>
              {postedCount}
            </Text>
            /{totalCount}
          </Text>
          {canCopyRecap ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy today's scores to clipboard"
              onPress={onCopyRecap}
              disabled={copyingRecap}
              testID="today-copy-recap"
              hitSlop={8}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.recap,
                (pressed || hovered) && styles.recapActive,
              ]}
            >
              {copyingRecap ? (
                <ActivityIndicator size="small" color={tokens.neon.pink} />
              ) : (
                <PixelIcon name="copy" size={16} color={tokens.neon.pink} />
              )}
              <Text variant="eyebrow" tone="link">
                Copy recap
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text variant="eyebrow" tone="secondary" style={styles.statLabel}>
          {allClear ? "All clear" : "Posted"}
        </Text>

        <View style={styles.games}>{games}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 40,
    paddingRight: tokens.space.sm,
  },
  date: { marginTop: 1 },
  rule: { flex: 1, height: tokens.bezel, backgroundColor: tokens.border.default },
  body: { paddingLeft: tokens.gutter, paddingTop: tokens.space.sm },
  statRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  statLabel: { marginTop: -2, marginBottom: tokens.space.lg },
  recap: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    marginTop: tokens.space.sm,
  },
  recapActive: { backgroundColor: tokens.bg.surface },
  games: { paddingBottom: tokens.space.lg },
});
