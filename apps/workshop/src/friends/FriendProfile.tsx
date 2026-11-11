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
import type { FriendProfileResponse } from "@workshop/shared/friends";
import {
  Avatar,
  Button,
  confirm,
  EmptyState,
  formatRelative,
  haptics,
  Screen,
  Text,
  tokens,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useClientRuntime } from "../lib/clientRuntime";
import { goBack } from "../lib/goBack";
import { localDateKey } from "../lib/localDateKey";

/**
 * Friend profile page — `/friends/:userId`. Shows the relationship state with
 * the matching action (add / cancel / accept-decline / remove) and mutual
 * friends. (Games — and the per-friend game list — moved to HighScore.) The
 * backend 404s profiles of users with no relationship and no mutual friends,
 * so this page can't probe strangers.
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
  const { token, routes } = useClientRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  // The profile endpoint still takes the viewer's day (it also serves
  // HighScore's per-game score lines); Workshop ignores those fields.
  const todayKey = localDateKey();

  const profileQuery = useQuery({
    queryKey: queryKeys.friends.profile(userId, todayKey),
    queryFn: () => fetchFriendProfile(userId, todayKey, token, via),
    enabled: !!token && !!userId,
    refetchInterval: livePoll,
  });
  const profile = profileQuery.data;

  const invalidateFriends = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });

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
      await invalidateFriends();
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
      await invalidateFriends();
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
      await invalidateFriends();
      goBack(routes.friends);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that friend."), tone: "danger" });
    },
  });

  const onUnfriend = async () => {
    const name = profile?.user.displayName?.trim() || "this friend";
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You can add each other again anytime.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate();
  };

  const name = profile?.user.displayName?.trim() || "Someone";
  const mutuals = profile ? mutualsLine(profile) : null;

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
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

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
});
