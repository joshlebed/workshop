// One weekly cooperative quest (spike #10): "You + Sam · 7/10", a progress
// bar split into your scores and theirs, and what's left. Used by the home
// panel and the friend profile. Numbers come from the server as-is.

import type { FriendQuest } from "@workshop/shared/friends";
import { Pressable, StyleSheet, View } from "react-native";
import { scoreType, Text, tokens } from "../../theme";
import { questCountLabel, questProgress, questStatusLine, questTitle } from "../lib/friendStreaks";

export function FriendQuestRow({
  quest,
  onPress,
  showTitle = true,
}: {
  quest: FriendQuest;
  onPress?: () => void;
  /** The profile already names the friend; it drops the title. */
  showTitle?: boolean;
}) {
  const done = quest.completedAt !== null;
  const total = Math.max(quest.target, quest.count, 1);
  const mine = Math.min(quest.viewerCount, total) / total;
  const theirs = Math.min(quest.friendCount, total - Math.min(quest.viewerCount, total)) / total;
  const testID = `friend-quest-${quest.friend.userId}`;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${questTitle(quest)}: ${quest.count} of ${quest.target} scores this week`}
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        onPress && (pressed || hovered) && styles.rowHover,
      ]}
    >
      <View style={styles.head}>
        {showTitle ? (
          <Text variant="label" numberOfLines={1} style={styles.title}>
            {questTitle(quest)}
          </Text>
        ) : (
          <Text variant="label" numberOfLines={1} style={styles.title}>
            Post {quest.target} scores together
          </Text>
        )}
        <Text style={[styles.count, done && styles.countDone]} testID={`${testID}-count`}>
          {questCountLabel(quest)}
        </Text>
      </View>
      {/* Your share in pink, theirs in yellow: a weaker player still adds. */}
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no">
        {done ? (
          <View style={[styles.fill, styles.fillDone, { flex: questProgress(quest) }]} />
        ) : (
          <>
            <View style={[styles.fill, styles.fillMine, { flex: mine }]} />
            <View style={[styles.fill, styles.fillTheirs, { flex: theirs }]} />
            <View style={{ flex: Math.max(0, 1 - mine - theirs) }} />
          </>
        )}
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {done
          ? questStatusLine(quest)
          : `${questStatusLine(quest)} · you ${quest.viewerCount}, them ${quest.friendCount}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 6,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    marginHorizontal: -tokens.space.sm,
    borderRadius: tokens.radius.sm,
  },
  rowHover: { backgroundColor: tokens.bg.elevated },
  head: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  title: { flex: 1, minWidth: 0, color: tokens.text.primary },
  count: { ...scoreType(10), lineHeight: 16, color: tokens.text.secondary },
  countDone: { color: tokens.neon.chartreuse },
  track: {
    height: 8,
    flexDirection: "row",
    overflow: "hidden",
    borderRadius: 2,
    backgroundColor: tokens.bg.elevated,
  },
  fill: { height: "100%" },
  fillMine: { backgroundColor: tokens.neon.pink },
  fillTheirs: { backgroundColor: tokens.neon.yellow },
  fillDone: { backgroundColor: tokens.neon.chartreuse },
});
