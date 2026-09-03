// One player, inside the PLAYERS panel. Relationship state and the matching
// action up top, then their deck: which games they play and what they scored
// today. Games you already have jump straight to that cartridge; games you
// don't are one tap to add.

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
import type { GamesResponse } from "@workshop/shared/games";
import { confirm, formatRelative, haptics } from "@workshop/ui";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { addGame } from "../games/api/games";
import { localDateKey } from "../games/lib/gameDate";
import { distillScore } from "../games/lib/scoreMarks";
import { summarizeGameScoreBody } from "../games/lib/scoresSummary";
import { useGamesRuntime } from "../games/runtime";
import { Avatar, Button, deck, GutterRow, PixelIcon, Text, tokens, useToast } from "../theme";
import { CartridgeLabel } from "./CartridgeLabel";
import { ScoreMarks } from "./ScoreMarks";

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

interface PlayerProfileProps {
  userId: string;
  /** Play-link vouch token (`/g/:token`) that lets us see a non-friend. */
  via: string | null;
  onBack: () => void;
  onOpenGame: (gameId: string) => void;
}

export function PlayerProfile({ userId, via, onBack, onOpenGame }: PlayerProfileProps) {
  const { token, user } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
  const [addingGameIds, setAddingGameIds] = useState<string[]>([]);

  // Their day next to yours. The deck already holds every one of your scores
  // for today, so a profile can be a head-to-head card instead of a list of
  // their results with no reference point.
  const myToday = queryClient.getQueryData<GamesResponse>(queryKeys.games.mine(todayKey));
  const myTokenFor = (gameId: string): string | null => {
    const mine = myToday?.games.find((g) => g.gameId === gameId);
    const entry = mine?.standings.entries.find((e) => e.userId === user?.id);
    if (!mine || !entry) return null;
    return distillScore(summarizeGameScoreBody(mine.game, entry)).token;
  };

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, todayKey),
    queryFn: () => fetchFriendProfile(userId, todayKey, token, via ?? undefined),
    enabled: !!token && !!userId,
    refetchInterval: livePoll,
  });
  const profile = profileQuery.data;

  const invalidate = () =>
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
      await invalidate();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
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
      await invalidate();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" });
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => removeFriendRequest(userId, token),
    onSuccess: async () => {
      // Declining can revoke this profile's own visibility, so step back out.
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
      onBack();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" });
    },
  });

  const unfriendMutation = useMutation({
    mutationFn: () => unfriend(userId, token),
    onSuccess: async () => {
      haptics.medium();
      await invalidate();
      onBack();
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
    <View style={styles.root} testID="friend-profile-screen">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to players"
        onPress={onBack}
        testID="friend-profile-back"
        style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
      >
        <PixelIcon name="arrow-left" size={16} color={tokens.text.secondary} />
        <Text variant="heading" tone="secondary" style={styles.backLabel}>
          Players
        </Text>
      </Pressable>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {profileQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        ) : profileQuery.isError || !profile ? (
          <View style={styles.center}>
            <Text tone="danger" style={styles.centerText}>
              {errorMessage(profileQuery.error, "User not found.")}
            </Text>
            <Button label="Back" variant="secondary" onPress={onBack} />
          </View>
        ) : (
          <>
            <GutterRow
              rule
              marker={
                <Avatar
                  name={profile.user.displayName}
                  imageUrl={userAvatarImageUrl(profile.user.userId)}
                  size="lg"
                />
              }
              style={styles.identity}
            >
              <Text
                variant="title"
                numberOfLines={1}
                testID="friend-profile-name"
                style={styles.name}
              >
                {name}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1} testID="friend-profile-status">
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
              <View style={styles.actions}>
                {profile.relationship === "none" ? (
                  <Button
                    label="Add friend"
                    onPress={() => sendMutation.mutate()}
                    loading={sendMutation.isPending}
                    testID="friend-profile-add"
                  />
                ) : null}
                {profile.relationship === "outbound" ? (
                  <Button
                    label="Cancel request"
                    variant="secondary"
                    onPress={() => cancelMutation.mutate()}
                    loading={cancelMutation.isPending}
                    testID="friend-profile-cancel"
                  />
                ) : null}
                {profile.relationship === "inbound" ? (
                  <>
                    <Button
                      label="Accept"
                      onPress={() => acceptMutation.mutate()}
                      loading={acceptMutation.isPending}
                      testID="friend-profile-accept"
                    />
                    <Button
                      label="Decline"
                      variant="secondary"
                      onPress={() => declineMutation.mutate()}
                      loading={declineMutation.isPending}
                      testID="friend-profile-decline"
                    />
                  </>
                ) : null}
              </View>
            </GutterRow>

            {profile.games === null ? (
              <GutterRow
                rule
                marker={<PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />}
                style={styles.games}
                testID="friend-profile-locked"
              >
                <Text variant="caption" tone="muted">
                  Add {name} as a friend to see what they play.
                </Text>
              </GutterRow>
            ) : profile.games.length === 0 ? (
              <GutterRow
                rule
                marker={<PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />}
                style={styles.games}
              >
                <Text variant="caption" tone="muted">
                  {isSelf ? "You haven't" : `${name} hasn't`} added any games yet.
                </Text>
              </GutterRow>
            ) : (
              <GutterRow
                rule
                marker={
                  <Text variant="heading" tone="secondary" style={styles.markerText}>
                    {String(profile.games.length)}
                  </Text>
                }
                style={styles.games}
                testID="friend-profile-games"
              >
                <View style={styles.headRow}>
                  <Text variant="caption" tone="muted" style={styles.headSpacer} />
                  <Text variant="caption" tone="muted" style={styles.headCol}>
                    Them
                  </Text>
                  <Text variant="caption" tone="muted" style={styles.headCol}>
                    You
                  </Text>
                </View>
                {profile.games.map((pg) => {
                  const adding = addingGameIds.includes(pg.game.id);
                  const theirs = pg.score
                    ? distillScore(
                        summarizeGameScoreBody(pg.game, {
                          scoreValue: pg.score.scoreValue,
                          scoreRaw: pg.score.scoreRaw,
                        }),
                      )
                    : null;
                  const mine = pg.viewerHasGame ? myTokenFor(pg.game.id) : null;
                  return (
                    <Pressable
                      key={pg.game.id}
                      accessibilityRole="button"
                      accessibilityLabel={
                        pg.viewerHasGame ? `Open ${pg.game.title}` : `Add ${pg.game.title}`
                      }
                      onPress={
                        pg.viewerHasGame
                          ? () => onOpenGame(pg.game.id)
                          : isSelf || adding
                            ? undefined
                            : () => addGameMutation.mutate(pg)
                      }
                      testID={
                        pg.viewerHasGame
                          ? `friend-profile-game-${pg.game.id}`
                          : `friend-profile-game-add-${pg.game.id}`
                      }
                      style={({ pressed }) => [styles.gameRow, pressed && styles.gameRowPressed]}
                    >
                      <CartridgeLabel title={pg.game.title} size={24} />
                      <Text variant="label" numberOfLines={1} style={styles.gameTitle}>
                        {pg.game.title}
                      </Text>
                      <View style={styles.scoreCell}>
                        {theirs?.marks.length ? <ScoreMarks marks={theirs.marks} size={5} /> : null}
                        {theirs?.token || !theirs?.marks.length ? (
                          <Text
                            variant="score"
                            tone="secondary"
                            numberOfLines={1}
                            style={[styles.gameScore, tokenScale(theirs?.token)]}
                          >
                            {theirs?.token ?? "\u2014"}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.scoreCell}>
                        {adding ? (
                          <ActivityIndicator size="small" color={tokens.neon.pink} />
                        ) : pg.viewerHasGame ? (
                          <Text
                            variant="score"
                            tone={mine ? "primary" : "muted"}
                            numberOfLines={1}
                            style={[styles.gameScore, tokenScale(mine)]}
                          >
                            {mine ?? "\u2014"}
                          </Text>
                        ) : isSelf ? null : (
                          <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </GutterRow>
            )}

            {profile.relationship === "friends" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${name} as a friend`}
                onPress={onUnfriend}
                disabled={unfriendMutation.isPending}
                testID="friend-profile-remove"
                style={({ pressed }) => [styles.unfriend, pressed && styles.unfriendPressed]}
              >
                <Text variant="label" style={styles.unfriendLabel}>
                  {unfriendMutation.isPending ? "Removing…" : "Remove friend"}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Press Start 2P is fixed-width, so a long token has to step down a size
 *  rather than wrap out of its column. */
function tokenScale(token: string | null | undefined) {
  if (!token || token.length <= 5) return null;
  return { fontSize: 8, lineHeight: 14 };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    height: 40,
    paddingHorizontal: tokens.space.lg,
  },
  backPressed: { opacity: 0.6 },
  backLabel: { fontSize: 10, lineHeight: 16 },
  scroll: { paddingBottom: tokens.space.xxl },
  center: { paddingVertical: tokens.space.xxl, alignItems: "center", gap: tokens.space.md },
  centerText: { textAlign: "center", paddingHorizontal: tokens.space.lg },
  identity: { paddingBottom: tokens.space.xl },
  name: { fontSize: 16, lineHeight: 24 },
  actions: { flexDirection: "row", gap: tokens.space.sm, paddingTop: tokens.space.md },
  unfriend: {
    alignSelf: "flex-start",
    marginLeft: deck.gutter + tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  unfriendPressed: { opacity: 0.6 },
  unfriendLabel: { color: tokens.status.danger, fontSize: 12 },
  games: { paddingBottom: tokens.space.xl },
  markerText: { fontSize: 10, lineHeight: 16, letterSpacing: 1 },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 44,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  gameRowPressed: { backgroundColor: tokens.bg.surface },
  gameTitle: { flex: 1, minWidth: 0 },
  gameScore: { fontSize: 11, lineHeight: 16, textAlign: "right" },
  headRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  headSpacer: { flex: 1 },
  headCol: { width: 66, textAlign: "right", textTransform: "uppercase", letterSpacing: 0.8 },
  scoreCell: { width: 66, alignItems: "flex-end", gap: 2 },
});
