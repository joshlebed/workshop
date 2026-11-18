import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import {
  acceptFriendRequestFrom,
  fetchFriendProfile,
  fetchHeadToHead,
  removeFriendRequest,
  sendFriendRequest,
  unfriend,
} from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { FriendProfileGame, FriendProfileResponse } from "@workshop/shared/friends";
import { formatScoreValue } from "@workshop/shared/games";
import { confirm, haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { blockUser } from "../../api/moderation";
import { ReportSheet, type ReportTarget } from "../../moderation/ReportSheet";
import {
  Avatar,
  Button,
  bodyType,
  EmptyState,
  PixelIcon,
  Screen,
  scoreType,
  sectionLabelType,
  Text,
  tokens,
  useToast,
} from "../../theme";
import { addGame } from "../api/games";
import { RECORD_COLOR, RecordBar } from "../components/RecordBar";
import { friendsSinceLabel, mutualFriendsLabel, totals } from "../lib/headToHead";
import { goBack } from "../lib/navigation";
import { useGamesRuntime } from "../runtime";
import { useToday } from "../state/viewDay";

/**
 * Friend profile page — `/friends/:userId`. Laid out like the You page: an
 * unboxed identity block, then ruled rows. A friend gets the head-to-head
 * panel (the 30-day record, tap for `HeadToHead.tsx`), their games with
 * today's score and a one-tap add for games you don't have, and the rare
 * actions (remove, report, block) as quiet rows at the bottom. Someone who
 * isn't a friend yet gets the matching request button instead of the panel. The backend 404s profiles of users with
 * no relationship and no mutual friends, so this page can't probe strangers.
 */

function relationshipLine(profile: FriendProfileResponse): string {
  switch (profile.relationship) {
    case "self":
      return "This is you";
    case "friends":
      return profile.friendsSince ? friendsSinceLabel(profile.friendsSince) : "Friends";
    case "outbound":
      return "Friend request sent";
    case "inbound":
      return "Wants to be friends";
    case "none":
      return "Not friends yet";
  }
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

  const todayKey = useToday();
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, todayKey),
    queryFn: () => fetchFriendProfile(userId, todayKey, token, via),
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
    // From a play link (`via`), the backend forms the friendship at once.
    mutationFn: () => sendFriendRequest(userId, token, via ? { via } : {}),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.profile(userId, todayKey) }),
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
  const mutuals = profile
    ? mutualFriendsLabel(profile.mutualFriends.map((f) => f.displayName?.trim() || "Someone"))
    : null;
  const isFriend = profile?.relationship === "friends";

  // Same key as the head-to-head screen's default range, so opening it is instant.
  const versusQuery = useQuery({
    queryKey: queryKeys.friends.headToHead(userId, "30", todayKey),
    queryFn: () => fetchHeadToHead(userId, "30", todayKey, token),
    enabled: !!token && !!userId && isFriend,
  });
  const versus = versusQuery.data ? totals(versusQuery.data.games) : null;
  const isSelf = profile?.relationship === "self" || (!!user?.id && user.id === userId);
  const scoresVisible = isSelf || profile?.relationship === "friends";

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
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </Pressable>
        <Text variant="title">Profile</Text>
        <View style={styles.navButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {profileQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : profileQuery.isError || !profile ? (
          <View style={styles.center}>
            <EmptyState
              title="Couldn't load this profile"
              description={errorMessage(profileQuery.error, "User not found.")}
              action={
                <Button label="Back" variant="secondary" onPress={() => goBack(routes.friends)} />
              }
            />
          </View>
        ) : (
          <>
            {/* Identity: the point of the page, so it gets the air and no box. */}
            <View style={styles.identity}>
              <Avatar
                name={profile.user.displayName}
                imageUrl={userAvatarImageUrl(profile.user.userId)}
                size="xl"
              />
              <View style={styles.identityText}>
                <Text variant="title" numberOfLines={2} testID="friend-profile-name">
                  {name}
                </Text>
                <Text tone="secondary" numberOfLines={1} testID="friend-profile-status">
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
            </View>

            {/* Not friends yet: the one thing to do about it. */}
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

            {/* Friends: the 30-day record, and the way into head to head. */}
            {isFriend ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`See how you and ${name} stack up`}
                onPress={() => router.push(routes.headToHead(userId) as Href)}
                testID="friend-profile-head-to-head"
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.versus,
                  (pressed || hovered) && styles.versusHover,
                ]}
              >
                <View style={styles.versusHead}>
                  <Text style={styles.sectionLabel}>You vs {name}</Text>
                  <Text style={styles.sectionLabel}>Last 30 days</Text>
                </View>
                {versus && versus.sharedDays === 0 ? (
                  <Text tone="secondary" testID="friend-profile-versus-empty">
                    No games in common
                  </Text>
                ) : (
                  <>
                    <View style={styles.versusScore} testID="friend-profile-versus-score">
                      <Text style={[styles.versusNumber, versus && { color: RECORD_COLOR.win }]}>
                        {versus ? versus.wins : "–"}
                      </Text>
                      <Text style={styles.versusDash}>–</Text>
                      <Text style={[styles.versusNumber, versus && { color: RECORD_COLOR.loss }]}>
                        {versus ? versus.losses : "–"}
                      </Text>
                    </View>
                    <RecordBar
                      wins={versus?.wins ?? 0}
                      ties={versus?.ties ?? 0}
                      losses={versus?.losses ?? 0}
                      height={8}
                    />
                  </>
                )}
                <View style={styles.versusCta}>
                  <Text style={styles.versusCtaLabel} numberOfLines={1}>
                    See how you and {name} stack up
                  </Text>
                  <PixelIcon name="chevron-right" size={16} color={tokens.neon.pink} />
                </View>
              </Pressable>
            ) : null}

            {/* Games. Public to every viewer; today's score is only sent for
                friends/self, so the score column is hidden otherwise.
                `games === null` only comes from a response cached before
                games went public. */}
            {profile.games === null ? (
              <View style={styles.group} testID="friend-profile-locked">
                <Text style={styles.sectionLabel}>Games</Text>
                <Text tone="secondary">Add {name} as a friend to see what they play.</Text>
              </View>
            ) : profile.games.length === 0 ? (
              <View style={styles.group}>
                <Text style={styles.sectionLabel}>Games</Text>
                <Text tone="secondary">
                  {isSelf
                    ? "You haven't added any games yet."
                    : `${name} hasn't added any games yet.`}
                </Text>
              </View>
            ) : (
              <View style={styles.group} testID="friend-profile-games">
                <View style={styles.groupHead}>
                  <Text style={styles.sectionLabel}>Games</Text>
                  {scoresVisible ? <Text style={styles.sectionLabel}>Today</Text> : null}
                </View>
                <View>
                  {profile.games.map((pg) => {
                    const adding = addingGameIds.includes(pg.game.id);
                    const value = pg.score?.scoreValue;
                    const today =
                      typeof value === "number"
                        ? formatScoreValue(value, pg.game.scoreUnit)
                        : pg.score
                          ? "✓"
                          : null;
                    return (
                      <Pressable
                        key={pg.game.id}
                        onPress={
                          pg.viewerHasGame
                            ? () => router.push(routes.game(pg.game.id) as Href)
                            : undefined
                        }
                        accessibilityLabel={pg.game.title}
                        accessibilityHint={
                          !scoresVisible
                            ? undefined
                            : today
                              ? `Today: ${today === "✓" ? "played" : today}`
                              : "Not played today"
                        }
                        disabled={!pg.viewerHasGame}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.row,
                          pg.viewerHasGame && (pressed || hovered) && styles.rowHover,
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
                            <Text style={styles.gameCoverGlyph}>🎮</Text>
                          )}
                        </View>
                        <Text variant="game" numberOfLines={1} style={styles.gameTitle}>
                          {pg.game.title}
                        </Text>
                        {pg.viewerHasGame || isSelf ? null : (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Add ${pg.game.title}`}
                            onPress={() => addGameMutation.mutate(pg)}
                            disabled={adding}
                            testID={`friend-profile-game-add-${pg.game.id}`}
                            hitSlop={8}
                            style={({
                              pressed,
                              hovered,
                            }: {
                              pressed: boolean;
                              hovered?: boolean;
                            }) => [styles.addBtn, (pressed || hovered) && styles.addBtnHover]}
                          >
                            {adding ? (
                              <ActivityIndicator size="small" color={tokens.accent.default} />
                            ) : (
                              <Text variant="label" style={styles.addLabel}>
                                Add
                              </Text>
                            )}
                          </Pressable>
                        )}
                        {scoresVisible ? (
                          today ? (
                            <View style={styles.scoreBox}>
                              <Text style={styles.scoreBoxText}>{today}</Text>
                            </View>
                          ) : (
                            <View style={styles.scoreEmpty}>
                              <Text style={styles.scoreEmptyText}>–</Text>
                            </View>
                          )
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Rare actions, kept quiet. Report and Block stay one tap away
                on every profile that isn't yours (Guideline 1.2). */}
            {isSelf ? null : (
              <View testID="friend-profile-safety">
                {isFriend ? (
                  <QuietRow
                    label="Remove friend"
                    busyLabel="Removing…"
                    busy={unfriendMutation.isPending}
                    onPress={onUnfriend}
                    testID="friend-profile-remove"
                  />
                ) : null}
                <QuietRow
                  label={`Report ${name}`}
                  onPress={() =>
                    setReportTarget({ userId, name: profile.user.displayName, kind: "profile" })
                  }
                  testID="friend-profile-report"
                />
                <QuietRow
                  label={`Block ${name}`}
                  busyLabel="Blocking…"
                  busy={blockMutation.isPending}
                  onPress={onBlock}
                  testID="friend-profile-block"
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
      <ReportSheet target={reportTarget} token={token} onClose={() => setReportTarget(null)} />
    </Screen>
  );
}

/** A rare action as a ruled row: plain label, no chevron, nothing loud. */
function QuietRow({
  label,
  busyLabel,
  busy = false,
  onPress,
  testID,
}: {
  label: string;
  busyLabel?: string;
  busy?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={busy}
      testID={testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && styles.rowHover,
      ]}
    >
      <Text tone="secondary" numberOfLines={1}>
        {busy && busyLabel ? busyLabel : label}
      </Text>
    </Pressable>
  );
}

const COVER = 32;
const SCORE_COLUMN = 56;

const styles = StyleSheet.create({
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  // Same rhythm as the You page: the identity block gets the most air, the
  // groups below share one steady beat.
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.xxl * 2,
    gap: tokens.space.xl,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xl,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xl,
    paddingVertical: tokens.space.sm,
  },
  identityText: { flex: 1, minWidth: 0, gap: tokens.space.xs },
  actionRow: { flexDirection: "row", gap: tokens.space.md },
  actionFlex: { flex: 1 },

  // The one framed panel on the page: it is a door, so it gets a bezel.
  versus: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  versusHover: { backgroundColor: tokens.bg.elevated },
  versusHead: { flexDirection: "row", justifyContent: "space-between", gap: tokens.space.md },
  versusScore: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  versusNumber: { ...scoreType(24), color: tokens.text.secondary },
  versusDash: { ...scoreType(16), color: tokens.text.secondary },
  versusCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.sm,
  },
  versusCtaLabel: {
    ...bodyType("semibold"),
    flex: 1,
    minWidth: 0,
    fontSize: tokens.font.size.md,
    color: tokens.neon.pink,
  },

  group: { gap: tokens.space.xs },
  groupHead: { flexDirection: "row", justifyContent: "space-between" },
  sectionLabel: { ...sectionLabelType(), color: tokens.text.secondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 52,
    marginHorizontal: -tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.default,
  },
  rowHover: { backgroundColor: tokens.bg.surface },
  gameCover: {
    width: COVER,
    height: COVER,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gameCoverImage: { width: COVER, height: COVER, borderRadius: tokens.radius.sm },
  gameCoverGlyph: { fontSize: 18 },
  gameTitle: { flex: 1, minWidth: 0, color: tokens.text.primary },
  // Today's score, boxed like the board's so the number reads at a glance.
  scoreBox: {
    minWidth: SCORE_COLUMN,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    alignItems: "center",
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  scoreBoxText: { ...scoreType(10), lineHeight: 14, color: tokens.text.primary },
  scoreEmpty: { minWidth: SCORE_COLUMN, alignItems: "center" },
  scoreEmptyText: { ...scoreType(10), lineHeight: 14, color: tokens.text.secondary, opacity: 0.5 },
  addBtn: {
    minWidth: 52,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 4,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  addBtnHover: { backgroundColor: tokens.accent.muted },
  addLabel: { ...bodyType("semibold"), color: tokens.neon.pinkTint },
});
