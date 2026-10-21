// Person — `/friends/:userId`. Reached from any avatar or name. Viewed
// through the same day lens as everything else: the shared `DateBar`, their
// games on that day (with their placing where you share the game), then a
// seven-day form grid over the games you have in common and a head-to-head
// tally. Relationship actions, report and block are unchanged.
//
// Head-to-head and the grid are composed from the viewer's cached per-day My
// Games queries (`useDayRange`) — no extra endpoint, but it only covers games
// you both have. TODO(api): a range parameter on the profile endpoint would
// cover their games you don't play.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import {
  acceptFriendRequestFrom,
  fetchFriendProfile,
  removeFriendRequest,
  sendFriendRequest,
  unfriend,
} from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { FriendProfileGame, FriendProfileResponse } from "@workshop/shared/friends";
import { confirm, formatRelative, haptics, useToast } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { blockUser } from "../../api/moderation";
import { ReportSheet, type ReportTarget } from "../../moderation/ReportSheet";
import { Avatar, Button, IconButton, PixelIcon, Screen, Text, tokens } from "../../theme";
import { addGame } from "../api/games";
import { DateBar } from "../components/DateBar";
import { DayPickerSheet } from "../components/DayPickerSheet";
import { DAY_RANGE_LENGTH, useDayRange } from "../hooks/useDayRange";
import { calendarLabel, localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { ordinal, shortScore } from "../lib/shortScore";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";

function relationshipLine(profile: FriendProfileResponse): string {
  switch (profile.relationship) {
    case "self":
      return "This is you";
    case "friends":
      return profile.friendsSince
        ? `Friends since ${formatRelative(profile.friendsSince)}`
        : "Friends";
    case "outbound":
      return "Friend request sent";
    case "inbound":
      return "Wants to be friends";
    case "none":
      return "Not friends yet";
  }
}

function mutualsLine(profile: FriendProfileResponse): string | null {
  const names = profile.mutualFriends.map((f) => f.displayName?.trim() || "Someone");
  if (names.length === 0) return null;
  const label = names.length === 1 ? "1 mutual friend" : `${names.length} mutual friends`;
  return `${label} · ${names.join(", ")}`;
}

const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

export default function FriendProfileScreen() {
  const params = useLocalSearchParams<{ userId?: string; via?: string }>();
  const userId = typeof params.userId === "string" ? params.userId : "";
  const via = typeof params.via === "string" ? params.via : undefined;
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const { viewDate, setViewDate } = useViewDay();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, viewDate),
    queryFn: () => fetchFriendProfile(userId, viewDate, token, via),
    enabled: !!token && !!userId,
    refetchInterval: viewDate === todayKey ? livePoll : false,
  });
  const profile = profileQuery.data;

  // Their placing on the viewed day, and the week grid, from my cached days.
  const range = useDayRange(todayKey, DAY_RANGE_LENGTH);
  const viewDay = range.find((d) => d.date === viewDate)?.data;
  const rankOn = (gameId: string): number | null =>
    viewDay?.games
      .find((g) => g.gameId === gameId)
      ?.standings.entries.find((e) => e.userId === userId)?.rank ?? null;

  const week = useMemo(() => {
    const games = range.find((d) => d.data)?.data?.games ?? [];
    const rows = games
      .map((mg) => ({
        gameId: mg.gameId,
        title: mg.game.title,
        cells: range.map((d) => {
          const entries =
            d.data?.games.find((g) => g.gameId === mg.gameId)?.standings.entries ?? [];
          const theirs = entries.find((e) => e.userId === userId && e.scoreRaw);
          const mine = entries.find((e) => e.userId === user?.id && e.scoreRaw);
          return {
            date: d.date,
            value: theirs ? shortScore(theirs) : null,
            won: theirs?.rank === 1,
            beatMe: !!theirs?.rank && !!mine?.rank && theirs.rank < mine.rank,
            lostToMe: !!theirs?.rank && !!mine?.rank && theirs.rank > mine.rank,
          };
        }),
      }))
      .filter((row) => row.cells.some((c) => c.value));
    let me = 0;
    let them = 0;
    for (const row of rows)
      for (const c of row.cells) {
        if (c.beatMe) them++;
        if (c.lostToMe) me++;
      }
    return { rows, me, them };
  }, [range, userId, user?.id]);

  const invalidateFriendsAndGames = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
      queryClient.invalidateQueries({ queryKey: ["games"] }),
    ]);

  const sendMutation = useMutation({
    mutationFn: () => sendFriendRequest(userId, token),
    onSuccess: async (data) => {
      haptics.medium();
      if (data.status === "accepted") {
        showToast({
          message: `You're now friends with ${data.friend?.displayName?.trim() || "them"}!`,
          tone: "success",
        });
      }
      await invalidateFriendsAndGames();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" });
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't cancel that request."), tone: "danger" });
    },
  });
  const acceptMutation = useMutation({
    mutationFn: () => acceptFriendRequestFrom(userId, token),
    onSuccess: async (data) => {
      haptics.medium();
      showToast({
        message: `You're now friends with ${data.friend.displayName?.trim() || "them"}!`,
        tone: "success",
      });
      await invalidateFriendsAndGames();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" });
    },
  });
  const declineMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
      goBack(routes.friends);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" });
    },
  });
  const unfriendMutation = useMutation({
    mutationFn: () => unfriend(userId, token),
    onSuccess: async () => {
      haptics.medium();
      await invalidateFriendsAndGames();
      goBack(routes.friends);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that friend."), tone: "danger" });
    },
  });
  const blockMutation = useMutation({
    mutationFn: () => blockUser(userId, token),
    onSuccess: async () => {
      haptics.medium();
      showToast({ message: `${name} is blocked.`, tone: "success" });
      await invalidateFriendsAndGames();
      goBack(routes.friends);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't block that user."), tone: "danger" });
    },
  });
  const onBlock = async () => {
    const ok = await confirm({
      title: `Block ${name}?`,
      message:
        "They'll be removed from your friends, you'll stop seeing each other's scores right away, and they can't send you friend requests. HighScore is notified. You can unblock from Edit profile.",
      confirmLabel: "Block",
      destructive: true,
    });
    if (ok) blockMutation.mutate();
  };
  const addGameMutation = useMutation({
    mutationFn: (game: FriendProfileGame) => {
      setAddingGameIds((ids) => [...ids, game.game.id]);
      return addGame(game.game.url, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["games"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.profile(userId, viewDate) }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" });
    },
    onSettled: (_data, _err, game) => {
      setAddingGameIds((ids) => ids.filter((id) => id !== game.game.id));
    },
  });
  const onUnfriend = async () => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. Past scores stay put.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate();
  };

  const name = profile?.user.displayName?.trim() || "Someone";
  const mutuals = profile ? mutualsLine(profile) : null;
  const isSelf = profile?.relationship === "self" || (!!user?.id && user.id === userId);
  const isToday = viewDate === todayKey;
  const dayGames = profile?.games ?? null;
  const playedCount = dayGames?.filter((g) => g.score).length ?? 0;

  return (
    <Screen testID="friend-profile-screen">
      <View style={styles.headerNav}>
        <IconButton
          accessibilityLabel="Back"
          onPress={() => goBack(routes.friends)}
          testID="friend-profile-back"
        >
          <PixelIcon name="arrow-left" color={tokens.text.primary} />
        </IconButton>
        <Text
          variant="heading"
          numberOfLines={1}
          style={styles.headerTitle}
          testID="friend-profile-name"
        >
          {profile ? name : "PROFILE"}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <DateBar
        date={viewDate}
        today={todayKey}
        onChange={setViewDate}
        onOpenPicker={() => setPickerOpen(true)}
        testIDPrefix="profile-date"
      />

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {profileQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        ) : profileQuery.isError || !profile ? (
          <View style={styles.center}>
            <Text variant="heading">COULDN'T LOAD</Text>
            <Text tone="secondary">{errorMessage(profileQuery.error, "User not found.")}</Text>
            <Button label="Back" variant="secondary" onPress={() => goBack(routes.friends)} />
          </View>
        ) : (
          <>
            <View style={styles.identity}>
              <Avatar
                name={profile.user.displayName}
                imageUrl={userAvatarImageUrl(profile.user.userId)}
                size="lg"
              />
              <View style={styles.identityText}>
                <Text variant="label" style={styles.identityName} numberOfLines={1}>
                  {name}
                </Text>
                <Text
                  variant="caption"
                  tone="secondary"
                  numberOfLines={1}
                  testID="friend-profile-status"
                >
                  {relationshipLine(profile)}
                </Text>
                {mutuals ? (
                  <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={2}
                    testID="friend-profile-mutuals"
                  >
                    {mutuals}
                  </Text>
                ) : null}
              </View>
              {profile.relationship === "friends" && week.rows.length > 0 ? (
                <View style={styles.h2h} testID="friend-profile-h2h">
                  <Text style={styles.h2hLabel}>7-DAY H2H</Text>
                  <Text style={styles.h2hScore}>
                    <Text style={[styles.h2hScore, week.me > week.them && styles.h2hWin]}>
                      {week.me}
                    </Text>
                    {" – "}
                    <Text style={[styles.h2hScore, week.them > week.me && styles.h2hLose]}>
                      {week.them}
                    </Text>
                  </Text>
                  <Text style={styles.h2hLabel}>YOU – THEM</Text>
                </View>
              ) : null}
            </View>

            {profile.relationship === "none" ? (
              <Button
                label="Add friend"
                onPress={() => sendMutation.mutate()}
                loading={sendMutation.isPending}
                disabled={sendMutation.isPending}
                testID="friend-profile-add"
              />
            ) : null}
            {profile.relationship === "outbound" ? (
              <Button
                label="Cancel request"
                variant="secondary"
                onPress={() => cancelMutation.mutate()}
                loading={cancelMutation.isPending}
                disabled={cancelMutation.isPending}
                testID="friend-profile-cancel"
              />
            ) : null}
            {profile.relationship === "inbound" ? (
              <View style={styles.actionRow}>
                <Button
                  label="Accept"
                  onPress={() => acceptMutation.mutate()}
                  loading={acceptMutation.isPending}
                  disabled={acceptMutation.isPending || declineMutation.isPending}
                  style={styles.actionFlex}
                  testID="friend-profile-accept"
                />
                <Button
                  label="Decline"
                  variant="secondary"
                  onPress={() => declineMutation.mutate()}
                  loading={declineMutation.isPending}
                  disabled={acceptMutation.isPending || declineMutation.isPending}
                  style={styles.actionFlex}
                  testID="friend-profile-decline"
                />
              </View>
            ) : null}

            {/* Their day. */}
            {dayGames === null ? (
              <View style={styles.locked} testID="friend-profile-locked">
                <PixelIcon name="gamepad" size={24} />
                <Text variant="heading" style={styles.lockedTitle}>
                  GAMES ARE FOR FRIENDS
                </Text>
                <Text variant="caption" tone="secondary" style={styles.lockedText}>
                  Add {name} as a friend to see what they play and how they did.
                </Text>
              </View>
            ) : (
              <View style={styles.section} testID="friend-profile-games">
                <Text style={styles.sectionLabel}>
                  {calendarLabel(viewDate)} ·{" "}
                  {dayGames.length === 0
                    ? "NO GAMES"
                    : playedCount === 0
                      ? isToday
                        ? "NOT PLAYED YET"
                        : "DIDN'T PLAY"
                      : `${playedCount} OF ${dayGames.length} PLAYED`}
                </Text>
                {dayGames.length === 0 ? (
                  <Text variant="caption" tone="secondary">
                    {isSelf ? "You haven't" : `${name} hasn't`} added any games yet.
                  </Text>
                ) : null}
                {dayGames.map((pg) => {
                  const adding = addingGameIds.includes(pg.game.id);
                  const rank = rankOn(pg.game.id);
                  const openable = pg.viewerHasGame;
                  return (
                    <Pressable
                      key={pg.game.id}
                      onPress={
                        openable
                          ? () => router.push(routes.game(pg.game.id, viewDate) as Href)
                          : undefined
                      }
                      accessibilityRole={openable ? "button" : undefined}
                      accessibilityLabel={pg.game.title}
                      disabled={!openable}
                      style={({ pressed }) => [
                        styles.gameRow,
                        openable && pressed && styles.pressed,
                      ]}
                      testID={`friend-profile-game-${pg.game.id}`}
                    >
                      {pg.game.iconUrl ? (
                        <Image
                          source={{ uri: pg.game.iconUrl }}
                          style={styles.gameIcon}
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        <View style={[styles.gameIcon, styles.gameIconFallback]}>
                          <PixelIcon name="gamepad" size={16} />
                        </View>
                      )}
                      <Text variant="heading" numberOfLines={1} style={styles.gameTitle}>
                        {pg.game.title}
                      </Text>
                      {pg.score ? (
                        <>
                          {rank != null ? (
                            <Text style={[styles.gameRank, rank === 1 && styles.gameRankFirst]}>
                              {ordinal(rank)}
                            </Text>
                          ) : null}
                          <Text style={styles.gameScore}>{shortScore(pg.score)}</Text>
                        </>
                      ) : (
                        <Text style={styles.gameEmpty}>—</Text>
                      )}
                      {!openable && !isSelf ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${pg.game.title}`}
                          onPress={() => addGameMutation.mutate(pg)}
                          disabled={adding}
                          testID={`friend-profile-game-add-${pg.game.id}`}
                          hitSlop={6}
                          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
                        >
                          {adding ? (
                            <ActivityIndicator size="small" color={tokens.neon.pink} />
                          ) : (
                            <Text style={styles.addText}>+ ADD</Text>
                          )}
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Last seven days over the games you share. */}
            {profile.relationship === "friends" && week.rows.length > 0 ? (
              <View style={styles.section} testID="friend-profile-week">
                <Text style={styles.sectionLabel}>LAST 7 DAYS · GAMES YOU SHARE</Text>
                <View style={styles.gridHead}>
                  <View style={styles.gridTitleCell} />
                  {range.map((d) => (
                    <Pressable
                      key={d.date}
                      accessibilityRole="button"
                      accessibilityLabel={d.date}
                      onPress={() => setViewDate(d.date)}
                      style={styles.gridCell}
                    >
                      <Text
                        style={[
                          styles.gridDay,
                          d.date === todayKey && styles.gridDayToday,
                          d.date === viewDate && styles.gridDaySelected,
                        ]}
                      >
                        {WEEKDAY_LETTER[new Date(`${d.date}T12:00:00`).getDay()]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {week.rows.map((row) => (
                  <View key={row.gameId} style={styles.gridRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={row.title}
                      onPress={() => router.push(routes.game(row.gameId, viewDate) as Href)}
                      style={styles.gridTitleCell}
                    >
                      <Text style={styles.gridTitle} numberOfLines={1}>
                        {row.title}
                      </Text>
                    </Pressable>
                    {row.cells.map((c) => (
                      <Pressable
                        key={c.date}
                        accessibilityRole="button"
                        accessibilityLabel={`${row.title} ${c.date}: ${c.value ?? "not played"}`}
                        onPress={() => router.push(routes.game(row.gameId, c.date) as Href)}
                        style={[styles.gridCell, c.date === viewDate && styles.gridCellSelected]}
                      >
                        <Text
                          style={[
                            styles.gridValue,
                            !c.value && styles.gridValueEmpty,
                            c.beatMe && styles.gridValueBeat,
                            c.lostToMe && styles.gridValueLost,
                          ]}
                          numberOfLines={1}
                        >
                          {c.value ?? "·"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
                <Text variant="caption" tone="secondary">
                  Pink: they beat you. Green: you beat them. Tap a cell for that board.
                </Text>
              </View>
            ) : null}

            {profile.relationship === "friends" ? (
              <Button
                label="Remove friend"
                variant="ghost"
                onPress={onUnfriend}
                loading={unfriendMutation.isPending}
                disabled={unfriendMutation.isPending}
                testID="friend-profile-remove"
              />
            ) : null}
            {isSelf ? null : (
              <View style={styles.safetyRow} testID="friend-profile-safety">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Report ${name}`}
                  onPress={() =>
                    setReportTarget({ userId, name: profile.user.displayName, kind: "profile" })
                  }
                  testID="friend-profile-report"
                  hitSlop={6}
                >
                  <Text variant="caption" tone="secondary" style={styles.safetyLabel}>
                    Report
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Block ${name}`}
                  onPress={onBlock}
                  disabled={blockMutation.isPending}
                  testID="friend-profile-block"
                  hitSlop={6}
                >
                  <Text variant="caption" tone="danger" style={styles.safetyLabel}>
                    {blockMutation.isPending ? "Blocking…" : "Block"}
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
      <DayPickerSheet
        visible={pickerOpen}
        selected={viewDate}
        today={todayKey}
        onSelect={setViewDate}
        onClose={() => setPickerOpen(false)}
      />
      <ReportSheet target={reportTarget} token={token} onClose={() => setReportTarget(null)} />
    </Screen>
  );
}

const pixelCaption = {
  fontFamily: tokens.font.pixel,
  fontSize: 8,
  lineHeight: 14,
  letterSpacing: 1,
  color: tokens.text.secondary,
} as const;

const styles = StyleSheet.create({
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.xs,
    paddingVertical: tokens.space.xs,
  },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 12, lineHeight: 18 },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.lg,
    gap: tokens.space.lg,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.xl,
  },
  pressed: { opacity: 0.7 },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  identityName: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  h2h: { alignItems: "center", gap: 2 },
  h2hLabel: pixelCaption,
  h2hScore: {
    fontFamily: tokens.font.pixel,
    fontSize: 16,
    lineHeight: 24,
    color: tokens.text.primary,
  },
  h2hWin: { color: tokens.neon.chartreuse },
  h2hLose: { color: tokens.neon.pink },
  actionRow: { flexDirection: "row", gap: tokens.space.sm },
  actionFlex: { flex: 1 },
  locked: {
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xl,
    paddingHorizontal: tokens.space.lg,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  lockedTitle: { fontSize: 11, lineHeight: 18 },
  lockedText: { textAlign: "center" },
  section: { gap: tokens.space.sm },
  sectionLabel: pixelCaption,
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 44,
    paddingHorizontal: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  gameIcon: { width: 24, height: 24, backgroundColor: tokens.bg.elevated },
  gameIconFallback: { alignItems: "center", justifyContent: "center" },
  gameTitle: { flex: 1, minWidth: 0, fontSize: 10, lineHeight: 16 },
  gameRank: {
    fontFamily: tokens.font.pixel,
    fontSize: 9,
    lineHeight: 14,
    color: tokens.text.secondary,
  },
  gameRankFirst: { color: tokens.neon.yellow },
  gameScore: {
    fontFamily: tokens.font.pixel,
    fontSize: 11,
    lineHeight: 16,
    color: tokens.text.primary,
  },
  gameEmpty: {
    fontFamily: tokens.font.pixel,
    fontSize: 11,
    lineHeight: 16,
    color: tokens.text.secondary,
  },
  addBtn: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.sm,
    height: 28,
    justifyContent: "center",
  },
  addText: { fontFamily: tokens.font.pixel, fontSize: 9, lineHeight: 14, color: tokens.neon.pink },
  gridHead: { flexDirection: "row", alignItems: "center" },
  gridRow: { flexDirection: "row", alignItems: "center", minHeight: 32 },
  gridTitleCell: { width: 92, paddingRight: tokens.space.xs },
  gridTitle: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 12,
    color: tokens.text.primary,
  },
  gridCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    borderWidth: tokens.bezel,
    borderColor: "transparent",
  },
  gridCellSelected: { borderColor: tokens.border.default },
  gridDay: pixelCaption,
  gridDayToday: { color: tokens.neon.yellow },
  gridDaySelected: { textDecorationLine: "underline" },
  gridValue: {
    fontFamily: tokens.font.pixel,
    fontSize: 8,
    lineHeight: 12,
    color: tokens.text.primary,
  },
  gridValueEmpty: { color: tokens.text.secondary, opacity: 0.6 },
  gridValueBeat: { color: tokens.neon.pink },
  gridValueLost: { color: tokens.neon.chartreuse },
  safetyRow: { flexDirection: "row", justifyContent: "center", gap: tokens.space.xl },
  safetyLabel: { textDecorationLine: "underline" },
});
