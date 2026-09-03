// Drawer panel 2 — one person, pushed in from the right on the same track as
// the friends list. `/friends/:userId` is still the URL; the back control is
// labelled with where it goes rather than a bare chevron.

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
import { confirm, haptics } from "@workshop/ui";
import { useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { addGame } from "../games/api/games";
import { localDateKey } from "../games/lib/gameDate";
import { useGamesRuntime } from "../games/runtime";
import { Avatar, Button, PixelIcon, pixelType, tokens, useToast } from "../theme";
import { Text } from "../theme/Text";
import { railScore } from "./railScore";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function relationshipLine(profile: FriendProfileResponse): string {
  switch (profile.relationship) {
    case "self":
      return "This is you";
    case "friends":
      return profile.friendsSince ? `Friends since ${shortDate(profile.friendsSince)}` : "Friends";
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

export interface FriendPanelProps {
  userId: string;
  via: string | undefined;
  onBack: () => void;
  /** Open one of their games in the ledger behind the drawer. */
  onOpenGame: (gameId: string) => void;
}

export function FriendPanel({ userId, via, onBack, onOpenGame }: FriendPanelProps) {
  const { token, user } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const todayKey = localDateKey();
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);

  // The drawer already knows who you tapped — the friends list is in cache —
  // so the identity block paints immediately and only the games skeleton
  // waits on the network. A blank panel for two seconds reads as broken.
  const known = queryClient
    .getQueryData<{ friends: { userId: string; displayName: string | null }[] }>(
      queryKeys.friends.all,
    )
    ?.friends.find((f) => f.userId === userId);

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, todayKey),
    queryFn: () => fetchFriendProfile(userId, todayKey, token, via),
    enabled: !!token && !!userId,
    refetchInterval: livePoll,
  });
  const profile = profileQuery.data;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests }),
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
      await invalidate();
      await profileQuery.refetch();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: async () => {
      await invalidate();
      await profileQuery.refetch();
    },
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
      await invalidate();
      await profileQuery.refetch();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" }),
  });

  const declineMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: async () => {
      // Declining can revoke this profile's own visibility — step back to the list.
      await invalidate();
      onBack();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" }),
  });

  const unfriendMutation = useMutation({
    mutationFn: () => unfriend(userId, token),
    onSuccess: async () => {
      haptics.medium();
      await invalidate();
      onBack();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't remove that friend."), tone: "danger" }),
  });

  const addGameMutation = useMutation({
    mutationFn: (game: FriendProfileGame) => {
      setAddingGameIds((ids) => [...ids, game.game.id]);
      return addGame(game.game.url, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["games"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.profile(userId, todayKey) }),
      ]);
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't add that game."), tone: "danger" }),
    onSettled: (_d, _e, game) => setAddingGameIds((ids) => ids.filter((id) => id !== game.game.id)),
  });

  const name = profile?.user.displayName?.trim() || "Someone";
  const mutuals = profile ? mutualsLine(profile) : null;
  const isSelf = profile?.relationship === "self" || (!!user?.id && user.id === userId);

  const onUnfriend = async () => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. Past scores stay put.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate();
  };

  return (
    <View style={styles.panel} testID="friend-profile-screen">
      <View style={styles.head}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to friends"
          onPress={onBack}
          hitSlop={10}
          testID="friend-profile-back"
          style={({ pressed }) => [styles.back, pressed && styles.dim]}
        >
          <PixelIcon name="chevron-left" size={16} color={tokens.neon.pink} />
          <Text style={styles.backLabel}>FRIENDS</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {profileQuery.isPending ? (
          <>
            <View style={styles.identity}>
              <Avatar
                name={known?.displayName ?? null}
                imageUrl={userAvatarImageUrl(userId)}
                size="lg"
              />
              <View style={styles.identityText}>
                <Text numberOfLines={2} style={styles.name}>
                  {known?.displayName?.trim() || "…"}
                </Text>
              </View>
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>GAMES</Text>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <View style={styles.skeletonBar} />
                </View>
              ))}
            </View>
          </>
        ) : profileQuery.isError || !profile ? (
          <View style={styles.errorBlock}>
            <Text style={styles.meta}>{errorMessage(profileQuery.error, "User not found.")}</Text>
            <Button label="Back to friends" variant="secondary" onPress={onBack} />
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
                <Text numberOfLines={2} style={styles.name} testID="friend-profile-name">
                  {name}
                </Text>
                <Text numberOfLines={1} style={styles.meta} testID="friend-profile-status">
                  {relationshipLine(profile)}
                </Text>
                {mutuals ? (
                  <Text numberOfLines={2} style={styles.meta} testID="friend-profile-mutuals">
                    {mutuals}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.actions}>
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
                <>
                  <Button
                    label="Accept request"
                    onPress={() => acceptMutation.mutate()}
                    loading={acceptMutation.isPending}
                    disabled={acceptMutation.isPending || declineMutation.isPending}
                    testID="friend-profile-accept"
                  />
                  <Button
                    label="Decline"
                    variant="ghost"
                    onPress={() => declineMutation.mutate()}
                    loading={declineMutation.isPending}
                    disabled={acceptMutation.isPending || declineMutation.isPending}
                    testID="friend-profile-decline"
                  />
                </>
              ) : null}
            </View>

            {profile.games === null ? (
              <View style={styles.locked} testID="friend-profile-locked">
                <Text style={styles.meta}>Add {name} as a friend to see what they play.</Text>
              </View>
            ) : profile.games.length === 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>GAMES</Text>
                <Text style={styles.meta}>
                  {isSelf ? "You haven't" : `${name} hasn't`} added any games yet.
                </Text>
              </View>
            ) : (
              <View style={styles.section} testID="friend-profile-games">
                <Text style={styles.sectionLabel}>GAMES</Text>
                {profile.games.map((pg) => {
                  const adding = addingGameIds.includes(pg.game.id);
                  // Same compact rule as the ledger — one score language
                  // everywhere outside the open board.
                  const body = pg.score
                    ? railScore(pg.game, {
                        scoreValue: pg.score.scoreValue,
                        scoreRaw: pg.score.scoreRaw,
                      })
                    : null;
                  const line = pg.score ? "played" : null;
                  return (
                    <View key={pg.game.id} style={styles.gameRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={pg.game.title}
                        disabled={!pg.viewerHasGame}
                        onPress={pg.viewerHasGame ? () => onOpenGame(pg.game.id) : undefined}
                        testID={`friend-profile-game-${pg.game.id}`}
                        style={({ pressed }) => [styles.gameMain, pressed && styles.dim]}
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
                        <Text numberOfLines={1} style={styles.gameTitle}>
                          {pg.game.title}
                        </Text>
                      </Pressable>
                      {body ? (
                        <Text numberOfLines={1} style={styles.gameScore}>
                          {body}
                        </Text>
                      ) : line ? (
                        <View style={styles.gamePlayed} />
                      ) : pg.viewerHasGame ? (
                        <Text style={styles.gameBlank}>–</Text>
                      ) : null}
                      {pg.viewerHasGame ? null : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${pg.game.title} to my games`}
                          onPress={() => addGameMutation.mutate(pg)}
                          disabled={adding}
                          hitSlop={6}
                          testID={`friend-profile-add-game-${pg.game.id}`}
                          style={({ pressed }) => [pressed && styles.dim]}
                        >
                          {adding ? (
                            <ActivityIndicator size="small" color={tokens.neon.pink} />
                          ) : (
                            <Text style={styles.addLabel}>ADD</Text>
                          )}
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {profile.relationship === "friends" ? (
              <View style={styles.dangerRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${name}`}
                  onPress={onUnfriend}
                  disabled={unfriendMutation.isPending}
                  hitSlop={6}
                  testID="friend-profile-remove"
                  style={({ pressed }) => [pressed && styles.dim]}
                >
                  <Text style={styles.danger}>REMOVE FRIEND</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.md,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  back: { flexDirection: "row", alignItems: "center", gap: 4 },
  backLabel: { ...pixelType(11), color: tokens.neon.pink },
  body: { paddingBottom: tokens.space.xxl * 2 },
  dim: { opacity: 0.6 },
  skeletonRow: {
    height: 40,
    justifyContent: "center",
    paddingHorizontal: tokens.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
  },
  skeletonBar: { height: 8, width: "45%", backgroundColor: tokens.bg.elevated },
  errorBlock: { gap: tokens.space.md, padding: tokens.space.lg },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.lg,
  },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  name: { ...pixelType(12), color: tokens.text.primary },
  meta: { fontSize: 12, lineHeight: 16, color: tokens.text.secondary },
  actions: { gap: tokens.space.sm, paddingHorizontal: tokens.space.lg },
  locked: { padding: tokens.space.lg },
  section: { paddingTop: tokens.space.xl, gap: tokens.space.xs },
  sectionLabel: {
    ...pixelType(10),
    color: tokens.text.secondary,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xs,
  },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
  },
  gameMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  gameCover: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.elevated,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  gameCoverImage: { width: "100%", height: "100%" },
  gameTitle: { ...pixelType(10), color: tokens.text.primary, flexShrink: 1 },
  gameScore: { ...pixelType(10), color: tokens.text.primary, flexShrink: 0 },
  gamePlayed: {
    width: 8,
    height: 8,
    backgroundColor: tokens.neon.chartreuse,
  },
  gameBlank: { ...pixelType(10), color: tokens.border.default },
  addLabel: { ...pixelType(10), color: tokens.neon.pink },
  dangerRow: { padding: tokens.space.lg, marginTop: tokens.space.lg },
  danger: { ...pixelType(10), color: tokens.status.danger },
});
