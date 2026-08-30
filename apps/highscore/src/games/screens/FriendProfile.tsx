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
import {
  Avatar,
  Button,
  confirm,
  EmptyState,
  formatRelative,
  haptics,
  Screen,
  Text,
  useToast,
} from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { tokens } from "../../theme";
import { addGame } from "../api/games";
import { localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";

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
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);

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
  const mutuals = profile ? mutualsLine(profile) : null;
  const isSelf = profile?.relationship === "self" || (!!user?.id && user.id === userId);

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
          <Text style={styles.navGlyph}>‹</Text>
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

            {/* Games. */}
            {profile.games === null ? (
              <View style={styles.lockedCard} testID="friend-profile-locked">
                <Text style={styles.lockedGlyph}>🎮</Text>
                <Text variant="label" style={styles.lockedTitle}>
                  Games are for friends
                </Text>
                <Text variant="caption" tone="muted" style={styles.lockedText}>
                  Add {name} as a friend to see what games they play.
                </Text>
              </View>
            ) : profile.games.length === 0 ? (
              <View style={styles.list}>
                <Text variant="caption" tone="muted" style={styles.listLabel}>
                  Games
                </Text>
                <Text variant="caption" tone="muted">
                  {isSelf ? "You haven't" : `${name} hasn't`} added any games yet.
                </Text>
              </View>
            ) : (
              <View style={styles.list} testID="friend-profile-games">
                <Text variant="caption" tone="muted" style={styles.listLabel}>
                  {profile.games.length === 1 ? "1 game" : `${profile.games.length} games`}
                </Text>
                {profile.games.map((pg) => {
                  const adding = addingGameIds.includes(pg.game.id);
                  const scoreBody = pg.score
                    ? summarizeGameScoreBody(pg.game, {
                        scoreValue: pg.score.scoreValue,
                        scoreRaw: pg.score.scoreRaw,
                      })
                    : null;
                  const scoreLine = scoreBody
                    ? `Today: ${scoreBody.split("\n")[0]}`
                    : pg.score
                      ? "Played today"
                      : "Not played today";
                  return (
                    <Pressable
                      key={pg.game.id}
                      onPress={
                        pg.viewerHasGame
                          ? () => router.push(routes.game(pg.game.id) as Href)
                          : undefined
                      }
                      accessibilityLabel={pg.game.title}
                      disabled={!pg.viewerHasGame}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.gameRow,
                        pg.viewerHasGame && (pressed || hovered) && styles.gameRowHover,
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
                      <View style={styles.gameText}>
                        <Text variant="label" numberOfLines={1} style={styles.gameTitle}>
                          {pg.game.title}
                        </Text>
                        <Text variant="caption" tone="muted" numberOfLines={1}>
                          {scoreLine}
                        </Text>
                      </View>
                      {pg.viewerHasGame ? (
                        <Text style={styles.chevron}>›</Text>
                      ) : isSelf ? null : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${pg.game.title}`}
                          onPress={() => addGameMutation.mutate(pg)}
                          disabled={adding}
                          testID={`friend-profile-game-add-${pg.game.id}`}
                          hitSlop={6}
                          style={({
                            pressed,
                            hovered,
                          }: {
                            pressed: boolean;
                            hovered?: boolean;
                          }) => [
                            styles.addBtn,
                            (pressed || hovered) && styles.addBtnHover,
                            adding && styles.addBtnBusy,
                          ]}
                        >
                          {adding ? (
                            <ActivityIndicator size="small" color={tokens.accent.default} />
                          ) : (
                            <Text style={styles.addLabel}>Add</Text>
                          )}
                        </Pressable>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const COVER = 40;

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
  navGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xl,
  },
  identityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.lg,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  actionRow: { flexDirection: "row", gap: tokens.space.md },
  actionFlex: { flex: 1 },
  lockedCard: {
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xxl,
    paddingHorizontal: tokens.space.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  lockedGlyph: { fontSize: 28, lineHeight: 34 },
  lockedTitle: { color: tokens.text.primary },
  lockedText: { textAlign: "center" },
  list: { gap: tokens.space.sm },
  listLabel: { letterSpacing: 0.4, textTransform: "uppercase" },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  gameRowHover: { backgroundColor: tokens.bg.elevated },
  gameCover: {
    width: COVER,
    height: COVER,
    borderRadius: tokens.radius.md,
    backgroundColor: `${tokens.accent.default}1F`,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gameCoverImage: { width: COVER, height: COVER, borderRadius: tokens.radius.md },
  gameCoverGlyph: { fontSize: 20 },
  gameText: { flex: 1, minWidth: 0, gap: 2 },
  gameTitle: { fontSize: tokens.font.size.md, color: tokens.text.primary },
  chevron: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.size.xl * 1.2,
    paddingHorizontal: tokens.space.sm,
  },
  addBtn: {
    minWidth: 64,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
    borderWidth: 1,
    borderColor: `${tokens.accent.default}55`,
  },
  addBtnHover: { backgroundColor: `${tokens.accent.default}33` },
  addBtnBusy: { opacity: 0.8 },
  addLabel: {
    color: tokens.accent.default,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
  },
});
