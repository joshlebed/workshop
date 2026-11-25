// Games home: the cooperative layer (spike #10), at the top of the card list.
//
//   1. A one-time celebration for each completed weekly quest the viewer
//      hasn't acknowledged ("Nice!" → `POST /v1/friends/quests/seen`).
//   2. "Keep it alive" lines: a pair streak (≥2 days) that reached yesterday
//      but not today on both sides — "You and Sam: 5 days — post to keep it".
//      Tapping one the viewer can save opens the post screen.
//   3. This week's quests ("Post N scores together"), at most five.
//
// Renders nothing when there is nothing to say. Every number is the server's
// (`GET /v1/friends?today=`, `GET /v1/friends/quests?today=`).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFriendQuests, fetchFriends, markFriendQuestSeen } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { FriendQuest, FriendQuestsResponse } from "@workshop/shared/friends";
import { haptics } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Button, PixelIcon, sectionLabelType, Text, tokens } from "../../theme";
import { useOpenProfile } from "../hooks/useOpenProfile";
import {
  celebrationText,
  doneQuestsLabel,
  keepAliveLines,
  moreStreaksLabel,
} from "../lib/friendStreaks";
import { useGamesRuntime } from "../runtime";
import { useToday } from "../state/viewDay";
import { FriendQuestRow } from "./FriendQuestRow";

/** Keep-alive lines shown before "+N more streaks". */
const KEEP_ALIVE_SHOWN = 2;

export function FriendsTogetherPanel() {
  const { token, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const openProfile = useOpenProfile();
  const livePoll = useLivePollingInterval();
  const today = useToday();

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token, today),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const questsKey = queryKeys.friends.quests(today);
  const questsQuery = useQuery({
    queryKey: questsKey,
    queryFn: () => fetchFriendQuests(today, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });

  const seenMutation = useMutation({
    mutationFn: (quest: FriendQuest) =>
      markFriendQuestSeen(quest.friend.userId, quest.weekStart, token),
    onMutate: (quest) => {
      // Gone at once; the server write is a formality the next read confirms.
      queryClient.setQueryData<FriendQuestsResponse>(questsKey, (prev) =>
        prev
          ? {
              ...prev,
              celebrations: prev.celebrations.filter(
                (c) =>
                  !(c.friend.userId === quest.friend.userId && c.weekStart === quest.weekStart),
              ),
            }
          : prev,
      );
    },
  });

  const lines = keepAliveLines(friendsQuery.data?.friends ?? [], Number.POSITIVE_INFINITY);
  const quests = questsQuery.data?.quests ?? [];
  // Open quests get a row each; finished ones fold into one line.
  const openQuests = quests.filter((q) => !q.completedAt);
  const doneQuests = quests.filter((q) => q.completedAt);
  const celebration = questsQuery.data?.celebrations[0] ?? null;
  if (!celebration && lines.length === 0 && quests.length === 0) return null;

  return (
    <View style={styles.wrap} testID="friends-together">
      {celebration ? (
        <QuestCelebration
          quest={celebration}
          onDone={() => {
            haptics.success();
            seenMutation.mutate(celebration);
          }}
        />
      ) : null}

      {lines.length > 0 ? (
        <View
          style={[
            styles.streakCard,
            !lines.some((l) => l.waitingOn !== "friend") && styles.streakCardQuiet,
          ]}
          testID="friends-keep-alive"
        >
          {lines.slice(0, KEEP_ALIVE_SHOWN).map((line, i) => (
            <Pressable
              key={line.friendId}
              accessibilityRole="button"
              accessibilityLabel={line.text}
              onPress={() =>
                line.waitingOn === "friend"
                  ? openProfile(line.friendId)
                  : router.push(routes.share as Href)
              }
              testID={`friends-keep-alive-${line.friendId}`}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.line,
                i > 0 && styles.lineRuled,
                (pressed || hovered) && styles.lineHover,
              ]}
            >
              <Text style={styles.lineFlame}>🔥</Text>
              <Text
                variant="label"
                numberOfLines={2}
                style={[styles.lineText, line.waitingOn === "friend" && styles.lineTextQuiet]}
              >
                {line.text}
              </Text>
              {line.waitingOn !== "friend" ? (
                <PixelIcon name="chevron-right" size={16} color={tokens.neon.pink} />
              ) : null}
            </Pressable>
          ))}
          {lines.length > KEEP_ALIVE_SHOWN ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(routes.friends as Href)}
              testID="friends-keep-alive-more"
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.line,
                styles.lineRuled,
                (pressed || hovered) && styles.lineHover,
              ]}
            >
              <Text variant="caption" tone="secondary" style={styles.lineText}>
                {moreStreaksLabel(lines.length - KEEP_ALIVE_SHOWN)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {quests.length > 0 ? (
        <View style={styles.questCard} testID="friends-quests">
          <View style={styles.questHead}>
            <Text style={styles.sectionLabel}>Weekly quests</Text>
            <Text style={styles.sectionLabel}>Post together · ends Sun</Text>
          </View>
          {openQuests.map((q) => (
            <FriendQuestRow
              key={q.friend.userId}
              quest={q}
              onPress={() => openProfile(q.friend.userId)}
            />
          ))}
          {doneQuests.length > 0 ? (
            <Text
              variant="caption"
              style={styles.doneLine}
              numberOfLines={2}
              testID="friends-quests-done"
            >
              ✓ {doneQuestsLabel(doneQuests)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function QuestCelebration({ quest, onDone }: { quest: FriendQuest; onDone: () => void }) {
  // A small pop on arrival; plain Animated so it runs on every runtime.
  const scale = useRef(new Animated.Value(0.92)).current;
  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [scale]);
  return (
    <Animated.View
      style={[styles.celebration, { transform: [{ scale }] }]}
      testID="friends-quest-celebration"
      accessibilityRole="summary"
    >
      <Text style={styles.celebrationGlyph}>🎉</Text>
      <View style={styles.celebrationCopy}>
        <Text variant="overline" style={styles.celebrationOverline}>
          Quest complete
        </Text>
        <Text variant="label" style={styles.celebrationText}>
          {celebrationText(quest)}
        </Text>
      </View>
      <Button label="Nice!" size="md" onPress={onDone} testID="friends-quest-celebration-done" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: tokens.space.sm, marginBottom: tokens.space.md },
  // One card; the yellow bezel says "this one is on you today".
  streakCard: {
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.yellow,
    backgroundColor: tokens.bg.surface,
    overflow: "hidden",
  },
  // Every line is waiting on a friend: nothing for the viewer to do.
  streakCardQuiet: { borderColor: tokens.border.default },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
  },
  lineRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: tokens.border.default },
  lineHover: { backgroundColor: tokens.bg.elevated },
  lineFlame: { fontSize: 16, lineHeight: 22 },
  lineText: { flex: 1, minWidth: 0, color: tokens.text.primary },
  lineTextQuiet: { color: tokens.text.secondary },
  doneLine: { color: tokens.neon.chartreuse, paddingVertical: tokens.space.xs },
  questCard: {
    gap: 2,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  questHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: tokens.space.md,
    marginBottom: 2,
  },
  sectionLabel: { ...sectionLabelType(), color: tokens.text.secondary },
  celebration: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.chartreuse,
    backgroundColor: tokens.bg.surface,
  },
  celebrationGlyph: { fontSize: 28, lineHeight: 34 },
  celebrationCopy: { flex: 1, minWidth: 0, gap: 2 },
  celebrationOverline: { color: tokens.neon.chartreuse },
  celebrationText: { color: tokens.text.primary },
});
