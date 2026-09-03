// A friend's profile, pushed onto the sheet stack over the timeline.
//
// The relationship action is the header's trailing control rather than a
// full-width button under the name — on a profile there is only ever one thing
// to do, so it belongs next to who it's about. Their games are ledger rows in
// the same grammar as the feed: today's result on the right, a one-tap add on
// games you don't have.

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
import { type Href, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { addGame } from "../games/api/games";
import { localDateKey } from "../games/lib/gameDate";
import { useGamesRuntime } from "../games/runtime";
import { SheetFrame } from "../nav/SheetFrame";
import type { SheetNav } from "../nav/SheetHost";
import { Avatar, Skeleton, Text, tokens, useToast } from "../theme";
import { GameGlyph } from "../timeline/GameLedger";
import { scoreDisplay } from "../timeline/scoreDisplay";

function relationshipLine(profile: FriendProfileResponse): string {
  switch (profile.relationship) {
    case "self":
      return "This is you";
    case "friends":
      return profile.friendsSince ? `Friends · ${formatRelative(profile.friendsSince)}` : "Friends";
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

export function FriendProfileSheet({
  userId,
  via,
  nav,
}: {
  userId: string;
  via: string | null;
  nav: SheetNav;
}) {
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, todayKey),
    queryFn: () => fetchFriendProfile(userId, todayKey, token, via ?? undefined),
    enabled: !!token && !!userId,
    refetchInterval: livePoll,
  });
  const profile = profileQuery.data;

  const invalidateFriendsAndGames = () =>
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
          message: `You're now friends with ${data.friend?.displayName?.trim() || "them"}`,
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
    onSuccess: () => invalidateFriendsAndGames(),
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't cancel that request."), tone: "danger" });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptFriendRequestFrom(userId, token),
    onSuccess: async (data) => {
      haptics.medium();
      showToast({
        message: `You're now friends with ${data.friend.displayName?.trim() || "them"}`,
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
      // Declining can revoke this sheet's own visibility (no relationship + no
      // mutuals = 404), so step back to whatever was underneath.
      await invalidateFriendsAndGames();
      nav.back();
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
      nav.back();
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
    onSettled: (_d, _e, game) => setAddingGameIds((ids) => ids.filter((id) => id !== game.game.id)),
  });

  const name = profile?.user.displayName?.trim() || "Someone";
  const mutuals = profile ? mutualsLine(profile) : null;
  const isSelf = profile?.relationship === "self" || (!!user?.id && user.id === userId);
  const needsAnswer = profile?.relationship === "none" || profile?.relationship === "inbound";

  const onUnfriend = async () => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. Past scores stay put.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate();
  };

  if (profileQuery.isPending) {
    return (
      <SheetFrame title="Profile" nav={nav} testID="friend-profile-screen">
        <Skeleton lines={5} />
      </SheetFrame>
    );
  }

  if (profileQuery.isError || !profile) {
    return (
      <SheetFrame title="Not found" nav={nav} testID="friend-profile-screen">
        <Text tone="secondary">
          {errorMessage(profileQuery.error, "This profile isn't available.")}
        </Text>
      </SheetFrame>
    );
  }

  return (
    <SheetFrame
      title={name}
      nav={nav}
      testID="friend-profile-screen"
      leading={
        <Avatar
          name={profile.user.displayName}
          imageUrl={userAvatarImageUrl(userId)}
          size="lg"
          style={styles.avatar}
        />
      }
      meta={
        <View style={styles.identityText}>
          <Text variant="caption" tone="muted" numberOfLines={1} testID="friend-profile-status">
            {relationshipLine(profile)}
          </Text>
          {mutuals ? (
            <Text variant="caption" tone="muted" numberOfLines={2} testID="friend-profile-mutuals">
              {mutuals}
            </Text>
          ) : null}
        </View>
      }
      // Only the *inviting* half of the relationship gets a prominent control.
      // Removing a friend and cancelling a request are quiet text at the very
      // bottom — nobody opens a profile to leave it.
      sub={
        needsAnswer ? (
          <View style={styles.actionBar}>
            {profile.relationship === "none" ? (
              <ActionButton
                label="Add friend"
                tone="primary"
                pending={sendMutation.isPending}
                onPress={() => sendMutation.mutate()}
                testID="friend-profile-add"
              />
            ) : null}
            {profile.relationship === "inbound" ? (
              <>
                <ActionButton
                  label="Accept"
                  tone="primary"
                  pending={acceptMutation.isPending}
                  onPress={() => acceptMutation.mutate()}
                  testID="friend-profile-accept"
                />
                <ActionButton
                  label="Decline"
                  tone="quiet"
                  pending={declineMutation.isPending}
                  onPress={() => declineMutation.mutate()}
                  testID="friend-profile-decline"
                />
              </>
            ) : null}
          </View>
        ) : null
      }
    >
      {profile.games === null ? (
        <Text tone="secondary" testID="friend-profile-locked">
          Add {name} as a friend to see what they play.
        </Text>
      ) : profile.games.length === 0 ? (
        <Text tone="secondary">
          {isSelf ? "You haven't" : `${name} hasn't`} added any games yet.
        </Text>
      ) : (
        <View style={styles.games} testID="friend-profile-games">
          <Text variant="eyebrow" tone="secondary">
            Today · {profile.games.length === 1 ? "1 game" : `${profile.games.length} games`}
          </Text>
          {profile.games.map((pg) => {
            const adding = addingGameIds.includes(pg.game.id);
            const line = pg.score
              ? scoreDisplay(pg.game, {
                  scoreValue: pg.score.scoreValue,
                  scoreRaw: pg.score.scoreRaw,
                }).value
              : null;
            return (
              <View key={pg.game.id} style={styles.gameRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={pg.game.title}
                  disabled={!pg.viewerHasGame}
                  onPress={
                    pg.viewerHasGame
                      ? () => router.push(routes.game(pg.game.id) as Href)
                      : undefined
                  }
                  testID={`friend-profile-game-${pg.game.id}`}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.gameTap,
                    pg.viewerHasGame && (pressed || hovered) && styles.pressedFill,
                  ]}
                >
                  <GameGlyph iconUrl={pg.game.iconUrl} size={20} />
                  <Text variant="label" numberOfLines={1} style={styles.gameTitle}>
                    {pg.game.title}
                  </Text>
                  {line ? (
                    <Text variant="score" numberOfLines={1} style={styles.gameScore}>
                      {line}
                    </Text>
                  ) : pg.score ? (
                    <Text variant="eyebrow" tone="secondary">
                      Played
                    </Text>
                  ) : (
                    <Text variant="eyebrow" tone="muted">
                      —
                    </Text>
                  )}
                </Pressable>
                {!pg.viewerHasGame && !isSelf ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${pg.game.title}`}
                    onPress={() => addGameMutation.mutate(pg)}
                    disabled={adding}
                    testID={`friend-profile-game-add-${pg.game.id}`}
                    hitSlop={6}
                    style={({ pressed }) => [styles.addBtn, pressed && styles.pressedFill]}
                  >
                    {adding ? (
                      <ActivityIndicator size="small" color={tokens.neon.pink} />
                    ) : (
                      <Text variant="eyebrow" tone="link">
                        Add
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {profile.relationship === "friends" ? (
        <QuietAction
          label="Remove friend"
          pending={unfriendMutation.isPending}
          onPress={onUnfriend}
          testID="friend-profile-remove"
        />
      ) : null}
      {profile.relationship === "outbound" ? (
        <QuietAction
          label="Cancel request"
          pending={cancelMutation.isPending}
          onPress={() => cancelMutation.mutate()}
          testID="friend-profile-cancel"
        />
      ) : null}
    </SheetFrame>
  );
}

function QuietAction({
  label,
  pending,
  onPress,
  testID,
}: {
  label: string;
  pending: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={pending}
      testID={testID}
      style={({ pressed }) => [styles.quietAction, pressed && styles.pressedFill]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={tokens.text.secondary} />
      ) : (
        // Quiet until you reach for it — nobody opens a profile to leave it.
        <Text variant="eyebrow" tone="secondary">
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function ActionButton({
  label,
  tone,
  pending,
  onPress,
  testID,
}: {
  label: string;
  tone: "primary" | "quiet" | "danger";
  pending: boolean;
  onPress: () => void;
  testID: string;
}) {
  const color =
    tone === "primary"
      ? tokens.neon.pink
      : tone === "danger"
        ? tokens.status.danger
        : tokens.border.default;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={pending}
      testID={testID}
      style={({ pressed }) => [
        styles.action,
        { borderColor: color },
        pressed && styles.pressedFill,
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Text
          variant="heading"
          tone={tone === "primary" ? "link" : tone === "danger" ? "danger" : "secondary"}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 44, height: 44 },
  identityText: { gap: 1 },
  quietAction: {
    marginTop: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
    alignItems: "flex-start",
  },
  actionBar: {
    flexDirection: "row",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.md,
  },
  action: {
    flex: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
  },
  pressedFill: { backgroundColor: tokens.bg.raised },
  games: { gap: tokens.space.xs },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 40,
    marginHorizontal: -tokens.space.xs,
  },
  gameTap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.xs,
    paddingVertical: tokens.space.xs,
  },
  gameTitle: { flex: 1, minWidth: 0, color: tokens.text.primary },
  gameScore: { color: tokens.text.primary, maxWidth: 140 },
  addBtn: {
    paddingHorizontal: tokens.space.sm,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
});
