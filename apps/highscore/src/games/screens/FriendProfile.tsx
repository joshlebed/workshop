// Profile — "one person, a week ending on the selected day". Header carries
// the relationship and its action; below it the week grid: rows are their
// games, columns the 7 days of the spine window, selected day highlighted.
// Tapping a cell moves the app to that day and opens that game's board.
//
// TODO(api): the grid is seven `GET /v1/friends/users/:id?period=` calls plus
// the viewer's own seven `GET /v1/games?period=` (already cached by the
// spine). A `/week?end=` endpoint would make this one request each.

import {
  type UseQueryResult,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import { confirm, formatRelative, haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { blockUser } from "../../api/moderation";
import { ScreenHeader } from "../../components/ScreenHeader";
import { DaySpine } from "../../day/DaySpine";
import { spineWindow, weekdayInitial } from "../../day/spine";
import { ReportSheet, type ReportTarget } from "../../moderation/ReportSheet";
import {
  Avatar,
  Button,
  IconButton,
  Notice,
  PixelIcon,
  Screen,
  Sheet,
  Text,
  tokens,
  useToast,
} from "../../theme";
import { addGame } from "../api/games";
import { useDayWindow } from "../hooks/useDayWindow";
import { goBack } from "../lib/navigation";
import { buildProfileWeek, type WeekCell } from "../lib/profileWeek";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
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
  const label = names.length === 1 ? "1 mutual" : `${names.length} mutuals`;
  return `${label} · ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
}

const PROFILE_STALE_MS = 5 * 60_000;

// Stable `combine` so the week memo only recomputes when a day's payload changes.
function combineProfiles(
  results: UseQueryResult<FriendProfileResponse>[],
): (FriendProfileResponse | undefined)[] {
  return results.map((r) => r.data);
}

export default function FriendProfileScreen() {
  const params = useLocalSearchParams<{ userId?: string; via?: string }>();
  const userId = typeof params.userId === "string" ? params.userId : "";
  const via = typeof params.via === "string" ? params.via : undefined;
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const { viewDate, setViewDate } = useViewDay();
  const { today, playedDays, activeDays, byDay } = useDayWindow(viewDate);
  const days = spineWindow(viewDate, today);
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, viewDate),
    queryFn: () => fetchFriendProfile(userId, viewDate, token, via),
    enabled: !!token && !!userId,
    refetchInterval: viewDate === today ? livePoll : false,
  });
  const profile = profileQuery.data ?? null;
  const canSeeGames = profile?.relationship === "friends" || profile?.relationship === "self";

  const weekQueries = useQueries({
    queries: days
      .filter((d) => d !== viewDate)
      .map((d) => ({
        queryKey: queryKeys.friends.profile(userId, d),
        queryFn: () => fetchFriendProfile(userId, d, token, via),
        enabled: !!token && !!userId && canSeeGames,
        staleTime: PROFILE_STALE_MS,
      })),
    combine: combineProfiles,
  });

  const week = useMemo(() => {
    const profileByDay = new Map<string, FriendProfileResponse>();
    if (profile) profileByDay.set(viewDate, profile);
    for (const p of weekQueries) if (p) profileByDay.set(p.periodKey, p);
    return buildProfileWeek({
      days,
      subjectId: userId,
      viewerId: user?.id ?? null,
      profileByDay,
      gamesByDay: byDay,
      summarize: (game, score) => summarizeGameScoreBody(game, score),
    });
  }, [profile, weekQueries, days, userId, user?.id, byDay, viewDate]);

  const name = profile?.user.displayName?.trim() || "Someone";
  const isSelf = profile?.relationship === "self" || (!!user && user.id === userId);

  const invalidateFriendsAndGames = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
      queryClient.invalidateQueries({ queryKey: ["games"] }),
    ]);

  const sendMutation = useMutation({
    mutationFn: () => sendFriendRequest(userId, token),
    onSuccess: async (data) => {
      haptics.medium();
      if (data.status === "accepted")
        showToast({
          message: `You're now friends with ${data.friend?.displayName?.trim() || "them"}!`,
          tone: "success",
        });
      await invalidateFriendsAndGames();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" }),
  });
  const cancelMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't cancel that request."), tone: "danger" }),
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
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" }),
  });
  const declineMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
      goBack(routes.friends);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" }),
  });
  const unfriendMutation = useMutation({
    mutationFn: () => unfriend(userId, token),
    onSuccess: async () => {
      haptics.medium();
      await invalidateFriendsAndGames();
      goBack(routes.friends);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't remove that friend."), tone: "danger" }),
  });
  const blockMutation = useMutation({
    mutationFn: () => blockUser(userId, token),
    onSuccess: async () => {
      haptics.medium();
      showToast({ message: `${name} is blocked.`, tone: "success" });
      await invalidateFriendsAndGames();
      goBack(routes.friends);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't block that user."), tone: "danger" }),
  });
  const addGameMutation = useMutation({
    mutationFn: (game: FriendProfileGame["game"]) => {
      setAddingGameIds((ids) => [...ids, game.id]);
      return addGame(game.url, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["games"] }),
        queryClient.invalidateQueries({ queryKey: ["friends", "profile", userId] }),
      ]);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" }),
    onSettled: (_d, _e, game) => setAddingGameIds((ids) => ids.filter((id) => id !== game.id)),
  });

  const onUnfriend = async () => {
    setMoreOpen(false);
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. You can add them again later.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate();
  };
  const onBlock = async () => {
    setMoreOpen(false);
    const ok = await confirm({
      title: `Block ${name}?`,
      message:
        "They'll be removed from your friends, you'll stop seeing each other's scores right away, and they can't send you friend requests. HighScore is notified. You can unblock from Edit profile.",
      confirmLabel: "Block",
      destructive: true,
    });
    if (ok) blockMutation.mutate();
  };

  const openCell = (gameId: string, date: string) => {
    if (date !== viewDate) setViewDate(date);
    router.push(routes.game(gameId, date) as Href);
  };

  let action: React.ReactNode = null;
  if (profile && !isSelf) {
    switch (profile.relationship) {
      case "none":
        action = (
          <Button
            label="Add friend"
            onPress={() => sendMutation.mutate()}
            loading={sendMutation.isPending}
            testID="friend-profile-add"
          />
        );
        break;
      case "outbound":
        action = (
          <Button
            label="Cancel request"
            variant="secondary"
            onPress={() => cancelMutation.mutate()}
            loading={cancelMutation.isPending}
            testID="friend-profile-cancel"
          />
        );
        break;
      case "inbound":
        action = (
          <View style={styles.actionRow}>
            <Button
              label="Accept"
              onPress={() => acceptMutation.mutate()}
              loading={acceptMutation.isPending}
              testID="friend-profile-accept"
              style={styles.actionGrow}
            />
            <Button
              label="Decline"
              variant="secondary"
              onPress={() => declineMutation.mutate()}
              loading={declineMutation.isPending}
              testID="friend-profile-decline"
            />
          </View>
        );
        break;
      default:
        action = null;
    }
  }

  return (
    <Screen testID="friend-profile-screen">
      <ScreenHeader
        onBack={() => goBack(routes.friends)}
        backTestID="friend-profile-back"
        right={
          profile && !isSelf ? (
            <IconButton
              accessibilityLabel="More"
              onPress={() => setMoreOpen(true)}
              testID="friend-profile-safety"
            >
              <PixelIcon name="more-horizontal" />
            </IconButton>
          ) : isSelf ? (
            <IconButton
              accessibilityLabel="Edit profile"
              onPress={() => router.push("/profile" as Href)}
            >
              <PixelIcon name="pencil" />
            </IconButton>
          ) : null
        }
      />
      {profileQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.neon.pink} />
        </View>
      ) : profileQuery.isError || !profile ? (
        <View style={styles.pad}>
          <Notice
            title="Couldn't load profile"
            description={errorMessage(profileQuery.error, "They may not be visible to you.")}
            action={
              <Button label="Back" variant="secondary" onPress={() => goBack(routes.friends)} />
            }
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.identity}>
            <Avatar
              name={profile.user.displayName}
              imageUrl={userAvatarImageUrl(userId)}
              size="lg"
            />
            <View style={styles.identityText}>
              <Text
                variant="title"
                numberOfLines={2}
                testID="friend-profile-name"
                style={styles.name}
              >
                {name}
              </Text>
              <Text variant="caption" tone="secondary" testID="friend-profile-status">
                {relationshipLine(profile)}
              </Text>
              {mutualsLine(profile) ? (
                <Text
                  variant="caption"
                  tone="secondary"
                  numberOfLines={1}
                  testID="friend-profile-mutuals"
                >
                  {mutualsLine(profile)}
                </Text>
              ) : null}
            </View>
          </View>
          {action ? <View style={styles.pad}>{action}</View> : null}

          {canSeeGames ? (
            <>
              <View style={styles.spine}>
                <DaySpine
                  playedDays={playedDays}
                  activeDays={activeDays}
                  testIDPrefix="friend-profile-day"
                />
              </View>
              <View style={styles.summary} testID="friend-profile-week">
                <Stat value={String(week.summary.plays)} label="plays this week" tone="primary" />
                <Stat
                  value={String(week.summary.wins)}
                  label={week.summary.wins === 1 ? "win" : "wins"}
                  tone={week.summary.wins > 0 ? "success" : "primary"}
                />
                <Stat
                  value={
                    week.summary.streak > 0
                      ? `🔥${week.summary.streak}${week.summary.streakCapped ? "+" : ""}`
                      : "—"
                  }
                  label="day streak"
                  tone={week.summary.streak > 1 ? "success" : "primary"}
                />
              </View>
              {week.rows.length === 0 ? (
                <View style={styles.pad}>
                  <Notice title={isSelf ? "No games yet" : `${name} hasn't added any games yet`} />
                </View>
              ) : (
                <View style={styles.grid} testID="friend-profile-games">
                  <View style={styles.gridHeader}>
                    <View style={styles.gridTitle} />
                    {days.map((d) => (
                      <Text
                        key={d}
                        variant="caption"
                        tone={d === viewDate ? "link" : "secondary"}
                        style={styles.gridDay}
                      >
                        {weekdayInitial(d)}
                      </Text>
                    ))}
                    <Text variant="caption" tone="secondary" style={styles.gridH2h}>
                      {isSelf ? "" : "H2H"}
                    </Text>
                  </View>
                  {week.rows.map((row) => (
                    <View
                      key={row.game.id}
                      style={styles.gridRow}
                      testID={`friend-profile-game-${row.game.id}`}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${row.game.title}`}
                        onPress={
                          row.viewerHasGame ? () => openCell(row.game.id, viewDate) : undefined
                        }
                        style={styles.gridTitle}
                      >
                        <Text
                          variant="caption"
                          numberOfLines={2}
                          tone={row.viewerHasGame ? "primary" : "secondary"}
                        >
                          {row.game.title}
                        </Text>
                      </Pressable>
                      {row.cells.map((cell) => (
                        <Cell
                          key={cell.date}
                          cell={cell}
                          selected={cell.date === viewDate}
                          onPress={
                            row.viewerHasGame
                              ? () => openCell(row.game.id, cell.date)
                              : () => setViewDate(cell.date)
                          }
                        />
                      ))}
                      <View style={styles.gridH2h}>
                        {row.viewerHasGame ? (
                          row.h2h && !isSelf ? (
                            <Text
                              variant="score"
                              tone={
                                row.h2h.viewer > row.h2h.subject
                                  ? "success"
                                  : row.h2h.viewer < row.h2h.subject
                                    ? "danger"
                                    : "secondary"
                              }
                              style={styles.h2hText}
                            >
                              {row.h2h.viewer}-{row.h2h.subject}
                            </Text>
                          ) : null
                        ) : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Add ${row.game.title}`}
                            testID={`friend-profile-game-add-${row.game.id}`}
                            disabled={addingGameIds.includes(row.game.id)}
                            onPress={() => addGameMutation.mutate(row.game)}
                            style={styles.addKey}
                          >
                            {addingGameIds.includes(row.game.id) ? (
                              <ActivityIndicator size="small" color={tokens.neon.pink} />
                            ) : (
                              <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
                            )}
                          </Pressable>
                        )}
                      </View>
                    </View>
                  ))}
                  <View style={styles.legend}>
                    <Legend state="won" label="won" />
                    <Legend state="played" label="played" />
                    <Legend state="none" label="skipped" />
                    {isSelf ? null : (
                      <Text variant="caption" tone="secondary">
                        H2H = your wins-theirs
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </>
          ) : (
            <View style={styles.pad}>
              <Notice
                title="Games are for friends"
                description="Add them to see their week."
                testID="friend-profile-locked"
              />
            </View>
          )}
        </ScrollView>
      )}

      <Sheet
        visible={moreOpen}
        onRequestClose={() => setMoreOpen(false)}
        testID="friend-profile-more"
      >
        <Text variant="heading" numberOfLines={1}>
          {name}
        </Text>
        {profile?.relationship === "friends" ? (
          <Button
            label="Remove friend"
            variant="secondary"
            onPress={onUnfriend}
            testID="friend-profile-remove"
          />
        ) : null}
        <Button
          label="Report"
          variant="secondary"
          onPress={() => {
            setMoreOpen(false);
            setTimeout(() => setReportTarget({ userId, name, kind: "profile" }), 260);
          }}
          testID="friend-profile-report"
        />
        <Button
          label="Block"
          variant="danger"
          onPress={onBlock}
          loading={blockMutation.isPending}
          testID="friend-profile-block"
        />
      </Sheet>
      <ReportSheet target={reportTarget} token={token} onClose={() => setReportTarget(null)} />
    </Screen>
  );
}

function Cell({
  cell,
  selected,
  onPress,
}: {
  cell: WeekCell;
  selected: boolean;
  onPress: () => void;
}) {
  const glyph =
    cell.state === "won" ? "👑" : cell.state === "none" ? "" : cell.state === "unknown" ? "·" : "●";
  const detail = cell.rank != null && cell.players != null ? `#${cell.rank}/${cell.players}` : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${cell.date}: ${cell.state}${detail ? `, ${detail}` : ""}`}
      onPress={onPress}
      testID={`friend-profile-cell-${cell.date}`}
      style={({ pressed }) => [
        styles.cell,
        selected && styles.cellSelected,
        pressed && styles.cellPressed,
      ]}
    >
      <Text
        style={[styles.cellGlyph, cell.state === "none" && styles.cellNone]}
        tone={cell.state === "played" ? "success" : "primary"}
      >
        {glyph || "○"}
      </Text>
    </Pressable>
  );
}

function Legend({ state, label }: { state: WeekCell["state"]; label: string }) {
  return (
    <View style={styles.legendItem}>
      <Text style={styles.legendGlyph} tone={state === "played" ? "success" : "primary"}>
        {state === "won" ? "👑" : state === "played" ? "●" : "○"}
      </Text>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </View>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "primary" | "success";
}) {
  return (
    <View style={styles.stat}>
      <Text variant="score" tone={tone} style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const CELL = 32;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  pad: { paddingHorizontal: tokens.space.lg, paddingVertical: tokens.space.sm },
  body: { paddingBottom: tokens.space.xxl },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
  },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: 13, lineHeight: 20 },
  actionRow: { flexDirection: "row", gap: tokens.space.sm },
  actionGrow: { flexGrow: 1 },
  spine: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.xs,
    backgroundColor: tokens.bg.canvas,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.bg.elevated,
    zIndex: 1,
  },
  summary: {
    flexDirection: "row",
    gap: tokens.space.md,
    marginHorizontal: tokens.space.lg,
    marginVertical: tokens.space.md,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 14, lineHeight: 22 },
  grid: { paddingHorizontal: tokens.space.md },
  gridHeader: { flexDirection: "row", alignItems: "center", paddingBottom: tokens.space.xs },
  gridRow: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.bg.elevated,
  },
  gridTitle: {
    flex: 1,
    minWidth: 0,
    paddingRight: tokens.space.xs,
    paddingLeft: tokens.space.xs,
    justifyContent: "center",
    height: CELL + 8,
  },
  gridDay: { width: CELL, textAlign: "center" },
  gridH2h: { width: 40, alignItems: "flex-end", justifyContent: "center" },
  h2hText: { fontSize: 10, lineHeight: 14 },
  cell: {
    width: CELL,
    height: CELL + 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: "transparent",
  },
  cellSelected: { borderColor: tokens.neon.pink, backgroundColor: tokens.accent.muted },
  cellPressed: { backgroundColor: tokens.bg.raised },
  cellGlyph: { fontSize: 13, lineHeight: 18 },
  cellNone: { color: tokens.border.default },
  addKey: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.xs,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  legendGlyph: { fontSize: 12, lineHeight: 16 },
});
