import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { blockUser } from "../../api/moderation";
import { DayHeader } from "../../components/DayHeader";
import { ReportSheet, type ReportTarget } from "../../moderation/ReportSheet";
import { Avatar, Button, Notice, PixelIcon, Screen, Text, tokens, useToast } from "../../theme";
import { addGame, fetchMyGames } from "../api/games";
import { formatDayHeading, localDateKey, shiftDateKey } from "../lib/gameDate";
import { headToHead } from "../lib/headToHead";
import { goBack } from "../lib/navigation";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { stripScoreLabel } from "../lib/stripScore";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";

/**
 * Friend profile page — `/friends/:userId`. Shows the relationship state with
 * the matching action (add / cancel / accept-decline / remove), mutual
 * friends, and — for friends (or yourself) — their game list with today's
 * score per game and a one-tap add for games you don't have. Non-friends see
 * a locked message instead of games. The backend 404s profiles of users with
 * no relationship and no mutual friends, so this page can't probe strangers.
 */

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

export default function FriendProfileScreen() {
  const params = useLocalSearchParams<{ userId?: string; via?: string }>();
  const userId = typeof params.userId === "string" ? params.userId : "";
  // Play-link vouch token (`/g/:token` → here for a not-yet-friend sharer). Lets
  // the backend show this profile past the anti-probe 404 so we can add them.
  const via = typeof params.via === "string" ? params.via : undefined;
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  // The profile reads on the shared day (home / board / here agree), so
  // "what did Alex do on Tuesday" is the same ‹ › as everywhere else.
  const { viewDate } = useViewDay();
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, viewDate),
    queryFn: () => fetchFriendProfile(userId, viewDate, token, via),
    enabled: !!token && !!userId,
    refetchInterval: livePoll,
  });
  const profile = profileQuery.data;

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
      // Declining can revoke this page's own visibility (no relationship +
      // no mutuals = 404), so land back on the friends list.
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
      // Same as decline: removing the edge may 404 this profile on refetch.
      await invalidateFriendsAndGames();
      goBack(routes.friends);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that friend."), tone: "danger" });
    },
  });

  // Guideline 1.2: block drops the friendship server-side and hides the pair
  // from each other's boards; the profile then 404s, so leave the page.
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
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(todayKey) }),
        queryClient.invalidateQueries({ queryKey: ["games", "discovery"] }),
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
    const name = profile?.user.displayName?.trim() || "this friend";
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

  const canCompare = !!user?.id && !isSelf && profile?.relationship === "friends";

  // Head-to-head on the viewed day, from my rotation's standings.
  const dayGamesQuery = useQuery({
    queryKey: queryKeys.games.mine(viewDate),
    queryFn: () => fetchMyGames(viewDate, token),
    enabled: !!token && canCompare,
  });
  const h2h = useMemo(
    () => (user?.id ? headToHead(dayGamesQuery.data, user.id, userId, stripScoreLabel) : null),
    [dayGamesQuery.data, user?.id, userId],
  );

  // Seven-day form: how many of my games they posted each day, ending on the
  // viewed day. Seven cached `GET /v1/games` reads — the same ones the home
  // ‹ › already warms. TODO(api): a per-user history endpoint would also
  // cover games outside my rotation.
  const weekKeys = useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftDateKey(viewDate, i - 6)),
    [viewDate],
  );
  const weekQueries = useQueries({
    queries: weekKeys.map((key) => ({
      queryKey: queryKeys.games.mine(key),
      queryFn: () => fetchMyGames(key, token),
      enabled: !!token && (canCompare || isSelf),
      staleTime: 60_000,
    })),
  });
  const subjectId = isSelf ? (user?.id ?? userId) : userId;
  const week = weekKeys.map((key, i) => {
    const data = weekQueries[i]?.data;
    const games = data?.games ?? [];
    let played = 0;
    let wins = 0;
    for (const g of games) {
      const e = g.standings.entries.find((x) => x.userId === subjectId && x.scoreRaw);
      if (!e) continue;
      played += 1;
      if (e.rank === 1) wins += 1;
    }
    return { key, played, wins, loading: !data, total: games.length };
  });
  const weekPlayed = week.reduce((n, d) => n + d.played, 0);
  const weekWins = week.reduce((n, d) => n + d.wins, 0);
  const dayHeading = formatDayHeading(viewDate, todayKey);

  return (
    <Screen testID="friend-profile-screen">
      <View style={styles.headerNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => goBack(routes.friends)}
          testID="friend-profile-back"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <PixelIcon name="arrow-left" size={24} color={tokens.text.primary} />
        </Pressable>
        <Text variant="title" style={styles.navTitle} numberOfLines={1}>
          {profile ? name : "Profile"}
        </Text>
        <View style={styles.navButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {profileQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        ) : profileQuery.isError || !profile ? (
          <View style={styles.center}>
            <Notice
              title="Couldn't load this profile"
              description={errorMessage(profileQuery.error, "User not found.")}
              action={
                <Button label="Back" variant="secondary" onPress={() => goBack(routes.friends)} />
              }
            />
          </View>
        ) : (
          <>
            {/* Identity + relationship. */}
            <View style={styles.identityCard}>
              <Avatar
                name={profile.user.displayName}
                imageUrl={userAvatarImageUrl(profile.user.userId)}
                size="lg"
              />
              <View style={styles.identityText}>
                <Text variant="heading" numberOfLines={1} testID="friend-profile-name">
                  {name}
                </Text>
                <Text
                  variant="caption"
                  tone="muted"
                  numberOfLines={1}
                  testID="friend-profile-status"
                >
                  {relationshipLine(profile)}
                </Text>
                {mutuals ? (
                  <Text
                    variant="caption"
                    tone="muted"
                    numberOfLines={2}
                    testID="friend-profile-mutuals"
                  >
                    {mutuals}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Relationship actions. */}
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
                  label="Accept request"
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

            {/* Form — last seven days ending on the viewed day. */}
            {canCompare || isSelf ? (
              <View style={styles.section} testID="friend-profile-form">
                <View style={styles.sectionHead}>
                  <Text variant="heading" style={styles.sectionTitle}>
                    Last 7 days
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {weekPlayed} played · {weekWins} {weekWins === 1 ? "win" : "wins"}
                  </Text>
                </View>
                <View style={styles.weekRow}>
                  {week.map((d) => (
                    <View
                      key={d.key}
                      style={[styles.weekCell, d.key === viewDate && styles.weekCellSelected]}
                      testID={`friend-profile-form-${d.key}`}
                    >
                      <Text
                        variant="score"
                        tone={d.wins > 0 ? "spotlight" : d.played > 0 ? "primary" : "muted"}
                        style={styles.weekCount}
                      >
                        {d.loading ? "·" : d.played}
                      </Text>
                      <Text variant="caption" tone="secondary" style={styles.weekDay}>
                        {weekdayLetter(d.key)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Head-to-head on the viewed day. */}
            {canCompare ? (
              <View style={styles.section} testID="friend-profile-h2h">
                <DayHeader testIDPrefix="friend-profile-day" />
                {h2h && h2h.games.length > 0 ? (
                  <>
                    <View style={styles.tally}>
                      <View style={styles.tallySide}>
                        <Text
                          variant="score"
                          tone={h2h.wins > h2h.losses ? "spotlight" : "primary"}
                          style={styles.tallyNum}
                        >
                          {h2h.wins}
                        </Text>
                        <Text variant="caption" tone="secondary">
                          You
                        </Text>
                      </View>
                      <Text variant="heading" tone="muted" style={styles.tallyVs}>
                        vs
                      </Text>
                      <View style={styles.tallySide}>
                        <Text
                          variant="score"
                          tone={h2h.losses > h2h.wins ? "spotlight" : "primary"}
                          style={styles.tallyNum}
                        >
                          {h2h.losses}
                        </Text>
                        <Text variant="caption" tone="secondary" numberOfLines={1}>
                          {name}
                        </Text>
                      </View>
                    </View>
                    {h2h.games.map((g) => (
                      <Pressable
                        key={g.gameId}
                        accessibilityRole="button"
                        accessibilityLabel={`${g.title}: you ${g.mine.label}, ${name} ${g.theirs.label}`}
                        onPress={() => router.push(routes.game(g.gameId, viewDate) as Href)}
                        testID={`friend-profile-h2h-${g.gameId}`}
                        style={({ pressed }) => [styles.h2hRow, pressed && styles.rowPressed]}
                      >
                        <Text
                          variant="score"
                          tone={g.leader === "me" ? "spotlight" : "primary"}
                          style={styles.h2hScore}
                        >
                          {g.mine.label}
                        </Text>
                        <View style={styles.h2hMid}>
                          <Text variant="label" numberOfLines={1} style={styles.h2hTitle}>
                            {g.title}
                          </Text>
                          <Text variant="caption" tone="secondary">
                            {g.leader === "tie"
                              ? "Tied"
                              : g.leader === "me"
                                ? "You lead"
                                : `${name} leads`}
                          </Text>
                        </View>
                        <Text
                          variant="score"
                          tone={g.leader === "them" ? "spotlight" : "primary"}
                          style={[styles.h2hScore, styles.h2hScoreRight]}
                        >
                          {g.theirs.label}
                        </Text>
                      </Pressable>
                    ))}
                  </>
                ) : (
                  <Text variant="caption" tone="muted" style={styles.sectionNote}>
                    {dayGamesQuery.isPending
                      ? "Loading…"
                      : `No game you both posted ${dayHeading.short === "Today" ? "today" : `on ${dayHeading.short}`}.`}
                  </Text>
                )}
              </View>
            ) : null}

            {/* Games. */}
            {profile.games === null ? (
              <View style={styles.lockedCard} testID="friend-profile-locked">
                <PixelIcon name="gamepad" size={32} color={tokens.text.secondary} />
                <Text variant="label" style={styles.lockedTitle}>
                  Games are for friends
                </Text>
                <Text variant="caption" tone="muted" style={styles.lockedText}>
                  Add {name} as a friend to see what games they play.
                </Text>
              </View>
            ) : profile.games.length === 0 ? (
              <View style={styles.section}>
                <Text variant="heading" style={styles.sectionTitle}>
                  Games
                </Text>
                <Text variant="caption" tone="muted">
                  {isSelf ? "You haven't" : `${name} hasn't`} added any games yet.
                </Text>
              </View>
            ) : (
              <View style={styles.section} testID="friend-profile-games">
                <View style={styles.sectionHead}>
                  <Text variant="heading" style={styles.sectionTitle}>
                    {profile.games.length === 1 ? "1 game" : `${profile.games.length} games`}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {dayHeading.short}
                  </Text>
                </View>
                {profile.games.map((pg) => {
                  const adding = addingGameIds.includes(pg.game.id);
                  const scoreBody = pg.score ? summarizeGameScoreBody(pg.game, pg.score) : null;
                  const scoreLine = scoreBody
                    ? scoreBody.split("\n")[0]
                    : pg.score
                      ? "Played"
                      : "Not played";
                  return (
                    <Pressable
                      key={pg.game.id}
                      onPress={
                        pg.viewerHasGame
                          ? () => router.push(routes.game(pg.game.id, viewDate) as Href)
                          : undefined
                      }
                      accessibilityLabel={pg.game.title}
                      disabled={!pg.viewerHasGame}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.gameRow,
                        pg.viewerHasGame && (pressed || hovered) && styles.rowPressed,
                      ]}
                      testID={`friend-profile-game-${pg.game.id}`}
                    >
                      <View style={styles.gameCover}>
                        {pg.game.iconUrl ? (
                          <Image
                            source={{ uri: pg.game.iconUrl }}
                            style={styles.gameCoverImage}
                            accessibilityIgnoresInvertColors
                          />
                        ) : (
                          <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
                        )}
                      </View>
                      <View style={styles.gameText}>
                        <Text variant="label" numberOfLines={1} style={styles.gameTitle}>
                          {pg.game.title}
                        </Text>
                        <Text
                          variant="caption"
                          tone={pg.score ? "primary" : "muted"}
                          numberOfLines={1}
                        >
                          {scoreLine}
                        </Text>
                      </View>
                      {pg.viewerHasGame ? (
                        <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
                      ) : isSelf ? null : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${pg.game.title}`}
                          onPress={() => addGameMutation.mutate(pg)}
                          disabled={adding}
                          testID={`friend-profile-game-add-${pg.game.id}`}
                          hitSlop={6}
                          style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
                        >
                          {adding ? (
                            <ActivityIndicator size="small" color={tokens.neon.pink} />
                          ) : (
                            <Text variant="heading" tone="link" style={styles.addLabel}>
                              Add
                            </Text>
                          )}
                        </Pressable>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {profile.relationship === "friends" ? (
              <Button
                label="Remove friend"
                variant="danger"
                onPress={onUnfriend}
                loading={unfriendMutation.isPending}
                disabled={unfriendMutation.isPending}
                testID="friend-profile-remove"
              />
            ) : null}

            {/* Safety (Guideline 1.2): report this name / photo, or block. */}
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
                  style={({ pressed }) => [styles.safetyBtn, pressed && styles.safetyBtnPressed]}
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
                  style={({ pressed }) => [styles.safetyBtn, pressed && styles.safetyBtnPressed]}
                >
                  <Text variant="caption" style={styles.blockLabel}>
                    {blockMutation.isPending ? "Blocking…" : "Block"}
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
      <ReportSheet target={reportTarget} token={token} onClose={() => setReportTarget(null)} />
    </Screen>
  );
}

function weekdayLetter(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "narrow" });
}

const COVER = 36;

const styles = StyleSheet.create({
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.xs,
    paddingVertical: tokens.space.sm,
  },
  navButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  navTitle: { flex: 1, textAlign: "center", fontSize: 13, lineHeight: 20 },
  body: { padding: tokens.space.lg, gap: tokens.space.lg, paddingBottom: tokens.space.xxl * 2 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xxl,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  actionRow: { flexDirection: "row", gap: tokens.space.md },
  actionFlex: { flex: 1 },
  section: { gap: tokens.space.sm },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  sectionTitle: { fontSize: 11, lineHeight: 18 },
  sectionNote: { paddingVertical: tokens.space.sm },
  weekRow: { flexDirection: "row", gap: tokens.space.xs },
  weekCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
    gap: 2,
  },
  weekCellSelected: { borderColor: tokens.neon.pink },
  weekCount: { fontSize: 14, lineHeight: 20 },
  weekDay: { fontSize: 10, lineHeight: 12 },
  tally: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.xl,
    paddingVertical: tokens.space.md,
  },
  tallySide: { alignItems: "center", gap: 2, minWidth: 80 },
  tallyNum: { fontSize: 28, lineHeight: 40 },
  tallyVs: { fontSize: 10, lineHeight: 16 },
  h2hRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  rowPressed: { backgroundColor: tokens.bg.elevated },
  h2hScore: { fontSize: 12, lineHeight: 18, letterSpacing: 0, minWidth: 56 },
  h2hScoreRight: { textAlign: "right" },
  h2hMid: { flex: 1, minWidth: 0, alignItems: "center", gap: 2 },
  h2hTitle: { color: tokens.text.primary },
  safetyRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: tokens.space.xl,
    paddingVertical: tokens.space.sm,
  },
  safetyBtn: { paddingHorizontal: tokens.space.sm, paddingVertical: 4 },
  safetyBtnPressed: { backgroundColor: tokens.bg.elevated },
  safetyLabel: { textDecorationLine: "underline" },
  blockLabel: { color: tokens.status.danger, textDecorationLine: "underline" },
  lockedCard: {
    alignItems: "center",
    gap: tokens.space.sm,
    padding: tokens.space.xl,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  lockedTitle: { color: tokens.text.primary },
  lockedText: { textAlign: "center" },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  gameCover: {
    width: COVER,
    height: COVER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
  },
  gameCoverImage: { width: COVER, height: COVER },
  gameText: { flex: 1, minWidth: 0, gap: 2 },
  gameTitle: { fontSize: tokens.font.size.md, color: tokens.text.primary },
  addBtn: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnPressed: { backgroundColor: tokens.accent.muted },
  addLabel: { fontSize: 10, lineHeight: 14 },
});
