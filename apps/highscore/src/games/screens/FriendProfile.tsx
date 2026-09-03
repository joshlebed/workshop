// One player's profile — `/friends/:userId`.
//
// The relationship action isn't a button in the page, it's the lit key in the
// dock, and it changes with the relationship: ADD / CANCEL / ACCEPT+DECLINE /
// REMOVE. The page itself is just who they are and what they play, so the
// content never rearranges when the relationship does.
//
// Backend rules are unchanged: profiles of strangers with no mutual friends
// 404, so this page can't be used to probe, and a `via` play-link token vouches
// past that gate.

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
import { confirm, formatRelative, haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { DOCK_HEIGHT, type DockKey, useDock } from "../../nav/dock";
import { Avatar } from "../../theme/Avatar";
import { Button } from "../../theme/Button";
import { EmptyState } from "../../theme/EmptyState";
import { Screen } from "../../theme/layout";
import { PixelIcon } from "../../theme/PixelIcon";
import { Text } from "../../theme/Text";
import { useToast } from "../../theme/Toast";
import { tokens } from "../../theme/tokens";
import { addGame, fetchMyGames } from "../api/games";
import { localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";

const RAIL = 42;

function relationshipLine(profile: FriendProfileResponse): string {
  switch (profile.relationship) {
    case "self":
      return "this is you";
    case "friends":
      return profile.friendsSince
        ? `player since ${formatRelative(profile.friendsSince)}`
        : "player";
    case "outbound":
      return "request sent";
    case "inbound":
      return "wants in";
    case "none":
      return "not a player yet";
  }
}

function mutualsLine(profile: FriendProfileResponse): string | null {
  const names = profile.mutualFriends.map((f) => f.displayName?.trim() || "Someone");
  if (names.length === 0) return null;
  const label = names.length === 1 ? "1 mutual" : `${names.length} mutuals`;
  return `${label} · ${names.join(", ")}`;
}

export default function FriendProfileScreen() {
  const params = useLocalSearchParams<{ userId?: string; via?: string }>();
  const userId = typeof params.userId === "string" ? params.userId : "";
  // Play-link vouch token (`/g/:token` → here for a not-yet-friend sharer).
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

  // Today's head-to-head, straight off the board's own cache: for every game
  // you both posted to today, who won. This is the question the screen exists
  // to answer, so it sits above the game list rather than being derivable only
  // by reading down two score columns.
  const boardQuery = useQuery({
    queryKey: queryKeys.games.mine(todayKey),
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const head2head = useMemo(() => {
    let mine = 0;
    let theirs = 0;
    for (const g of boardQuery.data?.games ?? []) {
      const a = g.standings.entries.find((e) => e.userId === user?.id)?.scoreValue;
      const b = g.standings.entries.find((e) => e.userId === userId)?.scoreValue;
      if (a == null || b == null) continue;
      if (a === b) continue;
      const iWin = g.game.scoreDirection === "asc" ? a < b : a > b;
      if (iWin) mine += 1;
      else theirs += 1;
    }
    return { mine, theirs, played: mine + theirs };
  }, [boardQuery.data, user?.id, userId]);

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

  const back = useCallback(() => goBack(routes.friends), [routes.friends]);

  const declineMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: async () => {
      // Declining can revoke this page's own visibility (no relationship + no
      // mutuals = 404), so land back on the players list.
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
      back();
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
      back();
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

  const name = profile?.user.displayName?.trim() || "Someone";
  const mutuals = profile ? mutualsLine(profile) : null;
  const isSelf = profile?.relationship === "self" || (!!user?.id && user.id === userId);
  const relationship = profile?.relationship ?? null;

  const onUnfriend = useCallback(async () => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. Past scores stay put.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate();
  }, [name, unfriendMutation]);

  // The dock carries the relationship. It's the only place the action lives —
  // no duplicate button in the page body.
  const dockKeys = useMemo<DockKey[]>(() => {
    const keys: DockKey[] = [];
    if (relationship === "none") {
      keys.push({
        id: "relate",
        label: "Add",
        glyph: "user-plus",
        tone: "primary",
        weight: 1.5,
        disabled: sendMutation.isPending,
        onPress: () => sendMutation.mutate(),
        testID: "friend-profile-add",
        accessibilityLabel: `Send ${name} a friend request`,
      });
    } else if (relationship === "outbound") {
      keys.push({
        id: "relate",
        label: "Cancel",
        glyph: "close",
        weight: 1.5,
        disabled: cancelMutation.isPending,
        onPress: () => cancelMutation.mutate(),
        testID: "friend-profile-cancel",
        accessibilityLabel: "Cancel friend request",
      });
    } else if (relationship === "inbound") {
      keys.push(
        {
          id: "relate",
          label: "Accept",
          glyph: "check",
          tone: "primary",
          weight: 1.5,
          disabled: acceptMutation.isPending || declineMutation.isPending,
          onPress: () => acceptMutation.mutate(),
          testID: "friend-profile-accept",
          accessibilityLabel: `Accept ${name}'s friend request`,
        },
        {
          id: "decline",
          label: "Decline",
          glyph: "close",
          disabled: acceptMutation.isPending || declineMutation.isPending,
          onPress: () => declineMutation.mutate(),
          testID: "friend-profile-decline",
        },
      );
    }
    keys.push({
      id: "back",
      label: "Back",
      glyph: "arrow-left",
      weight: 0.7,
      onPress: back,
      testID: "friend-profile-back",
    });
    return keys;
  }, [relationship, name, back, sendMutation, cancelMutation, acceptMutation, declineMutation]);
  useDock(dockKeys);

  return (
    <Screen testID="friend-profile-screen">
      {profileQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.neon.pink} />
        </View>
      ) : profileQuery.isError || !profile ? (
        <View style={styles.center}>
          <EmptyState
            title="No such player"
            description={errorMessage(profileQuery.error, "User not found.")}
            action={<Button label="Back" variant="secondary" onPress={back} />}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.identity}>
            <View style={styles.rail}>
              <Avatar
                name={profile.user.displayName}
                imageUrl={userAvatarImageUrl(profile.user.userId)}
                size="md"
              />
            </View>
            <View style={styles.identityText}>
              <Text
                variant="title"
                numberOfLines={1}
                style={styles.name}
                testID="friend-profile-name"
              >
                {name}
              </Text>
              <Text variant="caption" tone="secondary" testID="friend-profile-status">
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

          {!isSelf && head2head.played > 0 ? (
            <View style={styles.head2head} testID="friend-profile-head2head">
              <Text variant="heading" tone="secondary" style={styles.h2hCaption}>
                {`Today · ${head2head.played} ${head2head.played === 1 ? "game" : "games"} both played`}
              </Text>
              <View style={styles.h2hRow}>
                <Text variant="heading" tone="secondary" style={styles.h2hSide}>
                  You
                </Text>
                <Text
                  variant="score"
                  tone={head2head.mine > head2head.theirs ? "success" : "secondary"}
                  style={styles.h2hValue}
                >
                  {String(head2head.mine)}
                </Text>
                <Text variant="score" tone="secondary" style={styles.h2hDash}>
                  —
                </Text>
                <Text
                  variant="score"
                  tone={head2head.theirs > head2head.mine ? "primary" : "secondary"}
                  style={styles.h2hValue}
                >
                  {String(head2head.theirs)}
                </Text>
                <Text
                  variant="heading"
                  tone="secondary"
                  numberOfLines={1}
                  style={[styles.h2hSide, styles.h2hSideRight]}
                >
                  {name}
                </Text>
              </View>
            </View>
          ) : null}

          {profile.games === null ? (
            <View style={styles.locked} testID="friend-profile-locked">
              <PixelIcon name="gamepad" size={24} color={tokens.text.secondary} />
              <Text variant="caption" tone="secondary" style={styles.lockedText}>
                {`Add ${name} to see what they play.`}
              </Text>
            </View>
          ) : profile.games.length === 0 ? (
            <View style={styles.sectionHeader}>
              <Text variant="heading" tone="secondary" style={styles.sectionLabel}>
                {isSelf ? "No games on your board" : "No games yet"}
              </Text>
            </View>
          ) : (
            <View testID="friend-profile-games">
              <View style={styles.sectionHeader}>
                <Text variant="heading" tone="secondary" style={styles.sectionLabel}>
                  {profile.games.length === 1 ? "1 game" : `${profile.games.length} games`}
                </Text>
              </View>
              {profile.games.map((pg) => {
                const adding = addingGameIds.includes(pg.game.id);
                const scoreBody = pg.score
                  ? summarizeGameScoreBody(pg.game, {
                      scoreValue: pg.score.scoreValue,
                      scoreRaw: pg.score.scoreRaw,
                    })
                  : null;
                const value =
                  pg.score?.scoreValue != null
                    ? String(pg.score.scoreValue)
                    : (scoreBody?.split("\n")[0]?.slice(0, 6) ?? null);
                return (
                  <Pressable
                    key={pg.game.id}
                    onPress={
                      pg.viewerHasGame
                        ? () => router.push(routes.game(pg.game.id) as Href)
                        : undefined
                    }
                    accessibilityRole={pg.viewerHasGame ? "button" : undefined}
                    accessibilityLabel={pg.game.title}
                    disabled={!pg.viewerHasGame}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                      styles.gameRow,
                      pg.viewerHasGame && (pressed || hovered) && styles.gameRowActive,
                    ]}
                    testID={`friend-profile-game-${pg.game.id}`}
                  >
                    <View style={styles.rail}>
                      {pg.game.iconUrl ? (
                        <Image
                          source={{ uri: pg.game.iconUrl }}
                          style={styles.mark}
                          accessibilityIgnoresInvertColors
                        />
                      ) : (
                        <View style={[styles.mark, styles.markPlaceholder]}>
                          <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
                        </View>
                      )}
                    </View>
                    <Text variant="heading" numberOfLines={1} style={styles.gameTitle}>
                      {pg.game.title}
                    </Text>
                    {value ? (
                      <Text variant="score" style={styles.gameScore}>
                        {value}
                      </Text>
                    ) : (
                      <Text variant="caption" tone="secondary">
                        —
                      </Text>
                    )}
                    {pg.viewerHasGame || isSelf ? null : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${pg.game.title} to your board`}
                        onPress={() => addGameMutation.mutate(pg)}
                        disabled={adding}
                        testID={`friend-profile-game-add-${pg.game.id}`}
                        hitSlop={4}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.addKey,
                          (pressed || hovered) && styles.addKeyActive,
                        ]}
                      >
                        {adding ? (
                          <ActivityIndicator size="small" color={tokens.neon.pink} />
                        ) : (
                          <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
                        )}
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
          {profile.relationship === "friends" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${name} as a friend`}
              onPress={() => void onUnfriend()}
              disabled={unfriendMutation.isPending}
              testID="friend-profile-remove"
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.removeRow,
                (pressed || hovered) && styles.gameRowActive,
              ]}
            >
              <Text variant="heading" tone="danger" style={styles.removeLabel}>
                {`Remove ${name}`}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  body: { paddingBottom: DOCK_HEIGHT + tokens.space.xl },
  identity: {
    flexDirection: "row",
    paddingTop: tokens.space.lg,
    paddingRight: tokens.space.md,
    paddingBottom: tokens.space.lg,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  rail: {
    width: RAIL,
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  identityText: { flex: 1, minWidth: 0, paddingLeft: tokens.space.md, gap: tokens.space.sm },
  name: { fontSize: 14, color: tokens.text.primary },
  locked: {
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.xxl,
    paddingHorizontal: tokens.space.lg,
  },
  lockedText: { textAlign: "center" },
  head2head: {
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.lg,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  h2hCaption: { fontSize: 10 },
  h2hRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  h2hSide: { flex: 1, fontSize: 10 },
  h2hSideRight: { textAlign: "right" },
  h2hValue: { fontSize: 32, lineHeight: 40 },
  h2hDash: { fontSize: 14, lineHeight: 40 },
  removeRow: {
    marginTop: tokens.space.xxl,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.lg,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  removeLabel: { fontSize: 11 },
  sectionHeader: {
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.sm,
  },
  sectionLabel: { fontSize: 10 },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingRight: tokens.space.md,
    paddingVertical: tokens.space.md,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  gameRowActive: { backgroundColor: tokens.bg.surface },
  mark: {
    width: 24,
    height: 24,
    backgroundColor: tokens.bg.raised,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  markPlaceholder: { alignItems: "center", justifyContent: "center" },
  gameTitle: { flex: 1, minWidth: 0, paddingLeft: tokens.space.md, fontSize: 11 },
  gameScore: { fontSize: 14, color: tokens.text.primary },
  addKey: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  addKeyActive: { backgroundColor: tokens.accent.muted },
});
