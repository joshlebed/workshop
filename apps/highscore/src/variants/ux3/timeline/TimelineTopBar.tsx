// The only persistent chrome in the app: wordmark, friends, you.
//
// No bottom tab bar — there is one screen. The sticky strip underneath appears
// once you scroll past TODAY and reports which day is currently under the top
// of the feed, so scrolling six days back never loses the plot.

import type { User } from "@workshop/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Wordmark } from "../components/Wordmark";
import { Avatar, PixelIcon, Text, tokens } from "../theme";
import type { DayHeading } from "./dayLabels";

export interface TimelineTopBarProps {
  pendingRequests: number;
  sticky: DayHeading | null;
  user: User | null;
  onOpenFriends: () => void;
  onOpenAccount: () => void;
}

export function TimelineTopBar({
  pendingRequests,
  sticky,
  user,
  onOpenFriends,
  onOpenAccount,
}: TimelineTopBarProps) {
  return (
    <View testID="timeline-top-bar">
      <View style={styles.bar}>
        <Wordmark />
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              pendingRequests > 0 ? `Friends, ${pendingRequests} requests` : "Friends"
            }
            onPress={onOpenFriends}
            testID="open-friends"
            hitSlop={8}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.iconBtn,
              (pressed || hovered) && styles.iconBtnActive,
            ]}
          >
            <PixelIcon
              name="users"
              size={24}
              color={pendingRequests > 0 ? tokens.neon.pink : tokens.text.secondary}
            />
            {pendingRequests > 0 ? <View style={styles.dot} testID="friends-pending-dot" /> : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your account"
            onPress={onOpenAccount}
            testID="profile-menu-trigger"
            hitSlop={8}
            style={({ pressed }) => [styles.avatarBtn, pressed && styles.iconBtnActive]}
          >
            <Avatar
              name={user?.displayName ?? user?.email ?? null}
              imageUrl={user?.avatarUrl ?? null}
              size="md"
            />
          </Pressable>
        </View>
      </View>
      {sticky ? (
        <View style={styles.sticky} testID="sticky-day-marker">
          <Text variant="eyebrow" tone={sticky.label === "TODAY" ? "spotlight" : "secondary"}>
            {sticky.label}
          </Text>
          <Text variant="eyebrow" tone="muted">
            {sticky.date}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: tokens.bg.canvas,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  actions: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  iconBtnActive: { backgroundColor: tokens.bg.surface },
  avatarBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  dot: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 6,
    height: 6,
    backgroundColor: tokens.neon.pink,
  },
  sticky: {
    backgroundColor: tokens.bg.canvas,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
});
