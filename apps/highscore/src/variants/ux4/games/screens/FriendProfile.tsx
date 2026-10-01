// One player's day, game by game — the row you tapped in the BY PLAYER matrix,
// opened out. Their avatar continues into this header from wherever you came
// from (matrix row, standings row, players list).
//
// Games they play that you don't sit in the same list with a + on the end, so
// "what are they playing that I'm missing" is answered and acted on in one
// place. Non-friends see the relationship action and nothing else; the backend
// 404s profiles with no relationship and no mutuals, so this can't probe
// strangers.

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
import type {
  FriendProfileGame,
  FriendProfileResponse,
  FriendsResponse,
} from "@workshop/shared/friends";
import { confirm, formatRelative, haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { BackKey } from "../../components/BackKey";
import { DETAIL_IDENTITY } from "../../components/Flight";
import { KeyPanel } from "../../components/KeyPanel";
import {
  Avatar,
  Button,
  EmptyState,
  layout,
  PixelIcon,
  Screen,
  Text,
  tokens,
  useToast,
} from "../../theme";
import { addGame } from "../api/games";
import { GameCover } from "../components/GameCover";
import { localDateKey } from "../lib/gameDate";
import { scoreMark } from "../lib/matrix";
import { goBack } from "../lib/navigation";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";

function relationshipLine(profile: FriendProfileResponse): string {
  switch (profile.relationship) {
    case "self":
      return "This is you";
    case "friends":
      return profile.friendsSince
        ? `Playing together since ${formatRelative(profile.friendsSince)}`
        : "Playing together";
    case "outbound":
      return "Request sent";
    case "inbound":
      return "Wants to play with you";
    case "none":
      return "Not connected";
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
  // The friends list is already cached by every surface that links here, so the
  // header can show a real name the instant the screen mounts rather than
  // waiting a round trip — which is also what the row-into-header flight is
  // animating toward.
  const cachedName =
    queryClient
      .getQueryData<FriendsResponse>(queryKeys.friends.all)
      ?.friends.find((f) => f.userId === userId)?.displayName ?? null;

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
          message: `You're now playing with ${data.friend?.displayName?.trim() || "them"}`,
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
        message: `You're now playing with ${data.friend.displayName?.trim() || "them"}`,
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
      // Declining can revoke this page's own visibility (no relationship + no
      // mutuals = 404), so land back on the players list.
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
  const playedToday = (profile?.games ?? []).filter((g) => g.score).length;

  return (
    <Screen testID="friend-profile-screen">
      <View style={styles.nav}>
        <BackKey
          label="Friends"
          onPress={() => goBack(routes.friends)}
          testID="friend-profile-back"
        />
      </View>

      {profileQuery.isPending ? (
        // Render the identity slot immediately rather than a centred spinner:
        // the avatar only needs the route's userId, and the row that was
        // tapped is mid-flight toward exactly this rect (components/Flight.tsx).
        <>
          <View style={styles.identity}>
            <Avatar name={cachedName} imageUrl={userAvatarImageUrl(userId)} size="lg" />
            <View style={styles.identityText}>
              {cachedName ? (
                <Text variant="title" numberOfLines={2}>
                  {cachedName}
                </Text>
              ) : (
                <View style={styles.skeletonTitle} />
              )}
              <View style={styles.skeletonLine} />
            </View>
          </View>
          <View style={styles.center}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        </>
      ) : profileQuery.isError || !profile ? (
        <View style={styles.center}>
          <EmptyState
            title="Can't load this profile"
            description={errorMessage(profileQuery.error, "User not found.")}
            action={
              <Button label="Back" variant="secondary" onPress={() => goBack(routes.friends)} />
            }
          />
        </View>
      ) : (
        <>
          {/* Flight destination — see components/Flight.tsx. */}
          <View style={styles.identity}>
            <Avatar
              name={profile.user.displayName}
              imageUrl={userAvatarImageUrl(profile.user.userId)}
              size="lg"
            />
            <View style={styles.identityText}>
              <Text variant="title" numberOfLines={2} testID="friend-profile-name">
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

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {profile.relationship === "none" ? (
              <Button
                label="Ask to play"
                pixel
                onPress={() => sendMutation.mutate()}
                loading={sendMutation.isPending}
                testID="friend-profile-add"
              />
            ) : null}
            {profile.relationship === "outbound" ? (
              <Button
                label="Cancel request"
                variant="secondary"
                pixel
                onPress={() => cancelMutation.mutate()}
                loading={cancelMutation.isPending}
                testID="friend-profile-cancel"
              />
            ) : null}
            {profile.relationship === "inbound" ? (
              <View style={styles.actionRow}>
                <Button
                  label="Accept"
                  pixel
                  onPress={() => acceptMutation.mutate()}
                  loading={acceptMutation.isPending}
                  disabled={acceptMutation.isPending || declineMutation.isPending}
                  style={styles.actionFlex}
                  testID="friend-profile-accept"
                />
                <Button
                  label="Decline"
                  variant="secondary"
                  pixel
                  onPress={() => declineMutation.mutate()}
                  loading={declineMutation.isPending}
                  disabled={acceptMutation.isPending || declineMutation.isPending}
                  style={styles.actionFlex}
                  testID="friend-profile-decline"
                />
              </View>
            ) : null}

            {profile.games === null ? (
              <View style={styles.locked} testID="friend-profile-locked">
                <PixelIcon name="lock" size={24} color={tokens.text.secondary} />
                <Text variant="caption" tone="secondary" style={styles.lockedText}>
                  Scores are for players you're connected to. Ask {name} to play and their day joins
                  your grid.
                </Text>
              </View>
            ) : profile.games.length === 0 ? (
              <Text variant="caption" tone="secondary">
                {isSelf ? "You haven't" : `${name} hasn't`} added any games yet.
              </Text>
            ) : (
              <View testID="friend-profile-games">
                <Text variant="eyebrow" tone="secondary" style={styles.sectionLabel}>
                  {playedToday > 0
                    ? `Today · ${playedToday} of ${profile.games.length}`
                    : `${profile.games.length} games · none today`}
                </Text>
                {profile.games.map((pg) => (
                  <ProfileGameRow
                    key={pg.game.id}
                    entry={pg}
                    isSelf={isSelf}
                    adding={addingGameIds.includes(pg.game.id)}
                    onOpen={() => router.push(routes.game(pg.game.id) as Href)}
                    onAdd={() => addGameMutation.mutate(pg)}
                  />
                ))}
              </View>
            )}

            {profile.relationship === "friends" ? (
              // Quiet, not a red CTA anchoring the page: removing a friend is
              // rare, reversible only by re-inviting, and shouldn't compete with
              // the reason you came here.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove friend"
                onPress={onUnfriend}
                hitSlop={8}
                testID="friend-profile-remove"
                style={({ pressed }) => [styles.removeKey, pressed && styles.pressed]}
              >
                <Text variant="caption" tone="danger">
                  Remove friend
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </>
      )}

      <KeyPanel active="friends" />
    </Screen>
  );

  async function onUnfriend() {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. Past scores stay put.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate();
  }
}

function ProfileGameRow({
  entry,
  isSelf,
  adding,
  onOpen,
  onAdd,
}: {
  entry: FriendProfileGame;
  isSelf: boolean;
  adding: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const body = entry.score
    ? summarizeGameScoreBody(entry.game, {
        scoreValue: entry.score.scoreValue,
        scoreRaw: entry.score.scoreRaw,
      })
    : null;
  const line = entry.score ? (body?.split("\n")[0] ?? "played") : null;
  return (
    <View style={styles.gameRow} testID={`friend-profile-game-${entry.game.id}`}>
      <Pressable
        accessibilityRole={entry.viewerHasGame ? "button" : "text"}
        accessibilityLabel={
          entry.viewerHasGame
            ? `Open the ${entry.game.title} board`
            : `${entry.game.title} — not in your games`
        }
        onPress={entry.viewerHasGame ? onOpen : undefined}
        style={({ pressed }) => [styles.gameBody, pressed && styles.pressed]}
      >
        <GameCover iconUrl={entry.game.iconUrl} size={28} dim={!entry.score} />
        <Text variant="label" numberOfLines={1} style={styles.gameTitle}>
          {entry.game.title}
        </Text>
        {line ? (
          <Text variant="mono" numberOfLines={1} style={styles.gameScore}>
            {line}
          </Text>
        ) : (
          <Text variant="caption" tone="secondary" style={styles.gameScore}>
            not today
          </Text>
        )}
        {/* Same right-aligned comparable number the board and the peek use. */}
        <Text variant="cell" style={styles.gameMark}>
          {entry.score ? scoreMark(entry.score, body) : ""}
        </Text>
      </Pressable>
      {entry.viewerHasGame || isSelf ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${entry.game.title} to your games`}
          onPress={onAdd}
          disabled={adding}
          testID={`friend-profile-game-add-${entry.game.id}`}
          hitSlop={6}
          style={({ pressed }) => [styles.addKey, pressed && styles.pressed]}
        >
          {adding ? (
            <ActivityIndicator size="small" color={tokens.neon.pink} />
          ) : (
            <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Sized so the identity block below starts exactly at `DETAIL_IDENTITY.top`.
  nav: { height: DETAIL_IDENTITY.top, justifyContent: "center" },
  identity: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.sm,
    paddingHorizontal: layout.inset,
  },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  body: {
    paddingHorizontal: layout.inset,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.md,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  skeletonTitle: { width: 148, height: 18, backgroundColor: tokens.bg.surface },
  skeletonLine: { width: 96, height: 10, backgroundColor: tokens.bg.surface, marginTop: 6 },
  actionRow: { flexDirection: "row", gap: tokens.space.sm },
  actionFlex: { flex: 1 },
  locked: {
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xl,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
  },
  lockedText: { textAlign: "center" },
  sectionLabel: { letterSpacing: 1, paddingBottom: tokens.space.xs },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 48,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  gameBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  gameTitle: { width: 96, color: tokens.text.primary },
  gameScore: { flex: 1, minWidth: 0, textAlign: "right", color: tokens.text.secondary },
  gameMark: { minWidth: 36, textAlign: "right", color: tokens.text.primary, letterSpacing: 0 },
  pressed: { opacity: 0.6 },
  // Pink glyph, neutral bezel: a screen full of pink outlines spends the one
  // interactive colour on ten equal things and it stops meaning "tap this".
  addKey: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  removeKey: { alignSelf: "flex-start", marginTop: tokens.space.lg, paddingVertical: 6 },
});
