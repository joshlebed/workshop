import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import {
  acceptFriendRequestFrom,
  createFriendInvite,
  fetchFriendRequests,
  fetchFriends,
  fetchMutuals,
  removeFriendRequest,
  resetFriendInvite,
  sendFriendRequest,
  unfriend,
} from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { FriendSummary, MutualSummary } from "@workshop/shared/friends";
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
import { type Href, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { goBack } from "../lib/navigation";
import { shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";

/**
 * Friends screen (G2b, issue #286; directed requests + mutuals added with the
 * social-features pass) — behind the Games surface flag. Reachable from the
 * Games header and the profile/settings sheet.
 *
 * Three sections: pending inbound requests (accept/deny inline), my friends,
 * and "people you may know" (friends of friends, most-connected first, with a
 * one-tap request button). Every person card opens `/friends/:userId`. The
 * share-link invite stays the universal add path for people outside the graph.
 */

/** "1 mutual friend · Alice" / "2 mutual friends · Alice & Bob" / "+N". */
export function mutualLine(m: MutualSummary): string {
  const names = m.mutualFriends.map((f) => f.displayName?.trim() || "Someone");
  const count = m.mutualCount === 1 ? "1 mutual friend" : `${m.mutualCount} mutual friends`;
  if (names.length === 0) return count;
  if (names.length === 1) return `${count} · ${names[0]}`;
  if (names.length === 2) return `${count} · ${names[0]} & ${names[1]}`;
  return `${count} · ${names[0]}, ${names[1]} +${names.length - 2}`;
}

export default function FriendsScreen() {
  const { token, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  // Per-row in-flight state — one mutation serves many mutual cards.
  const [requestingIds, setRequestingIds] = useState<string[]>([]);
  const [answeringIds, setAnsweringIds] = useState<string[]>([]);

  const enabled = !!token;
  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled,
    refetchInterval: livePoll,
  });
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled,
    refetchInterval: livePoll,
  });
  const mutualsQuery = useQuery({
    queryKey: queryKeys.friends.mutuals,
    queryFn: () => fetchMutuals(token),
    enabled,
  });
  const friends = friendsQuery.data?.friends ?? [];
  const inbound = requestsQuery.data?.inbound ?? [];
  const outboundIds = new Set((requestsQuery.data?.outbound ?? []).map((r) => r.userId));
  // Inbound requesters surface in the Requests section — don't repeat them
  // below as suggestions.
  const inboundIds = new Set(inbound.map((r) => r.userId));
  const mutuals = (mutualsQuery.data?.mutuals ?? []).filter((m) => !inboundIds.has(m.userId));

  const inviteMutation = useMutation({
    mutationFn: () => createFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      setInviteUrl(data.url);
      const result = await shareOrCopyLink(data.url);
      if (result === "copied") {
        showToast({ message: "Invite link copied", tone: "success" });
      } else if (result === "failed") {
        showToast({ message: "Couldn't copy — copy the link below manually.", tone: "danger" });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't create an invite link."), tone: "danger" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      setInviteUrl(data.url);
      const result = await shareOrCopyLink(data.url);
      if (result === "copied") {
        showToast({ message: "New link copied — the old one no longer works", tone: "success" });
      } else if (result === "failed") {
        showToast({
          message: "New link created — copy it below. The old one no longer works.",
          tone: "danger",
        });
      } else {
        showToast({ message: "New link created — the old one no longer works", tone: "success" });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't reset the invite link."), tone: "danger" });
    },
  });

  const onReset = async () => {
    const ok = await confirm({
      title: "Reset invite link?",
      message:
        "Your current link will stop working. Anyone you've already shared it with won't be able to use it.",
      confirmLabel: "Reset link",
      destructive: true,
    });
    if (ok) resetMutation.mutate();
  };

  const unfriendMutation = useMutation({
    mutationFn: (userId: string) => unfriend(userId, token),
    onSuccess: async () => {
      haptics.medium();
      // Drop them from My Games / per-game standings too — friendship gates
      // score visibility, so the social board must re-fetch without them.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that friend."), tone: "danger" });
    },
  });

  const sendRequestMutation = useMutation({
    mutationFn: (userId: string) => {
      setRequestingIds((ids) => [...ids, userId]);
      return sendFriendRequest(userId, token);
    },
    onSuccess: async (data) => {
      haptics.medium();
      if (data.status === "accepted") {
        showToast({
          message: `You're now friends with ${data.friend?.displayName?.trim() || "them"}!`,
          tone: "success",
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
          queryClient.invalidateQueries({ queryKey: ["games"] }),
        ]);
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" });
    },
    onSettled: (_data, _err, userId) => {
      setRequestingIds((ids) => ids.filter((id) => id !== userId));
    },
  });

  const acceptRequestMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return acceptFriendRequestFrom(userId, token);
    },
    onSuccess: async (data) => {
      haptics.medium();
      showToast({
        message: `You're now friends with ${data.friend.displayName?.trim() || "them"}!`,
        tone: "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" });
    },
    onSettled: (_data, _err, userId) => {
      setAnsweringIds((ids) => ids.filter((id) => id !== userId));
    },
  });

  const denyRequestMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return removeFriendRequest(userId, token);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" });
    },
    onSettled: (_data, _err, userId) => {
      setAnsweringIds((ids) => ids.filter((id) => id !== userId));
    },
  });

  const onRemove = async (friend: FriendSummary) => {
    const name = friend.displayName?.trim() || "this friend";
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. Past scores stay put.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate(friend.userId);
  };

  const onCopy = async () => {
    if (!inviteUrl) return;
    const ok = await shareOrCopyLink(inviteUrl);
    if (ok === "copied") showToast({ message: "Invite link copied", tone: "success" });
  };

  const openProfile = (userId: string) => router.push(routes.friendProfile(userId) as Href);

  return (
    <Screen testID="friends-screen">
      <View style={styles.headerNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => goBack(routes.home)}
          testID="friends-back"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <Text style={styles.navGlyph}>‹</Text>
        </Pressable>
        <Text variant="title">Friends</Text>
        <View style={styles.navButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Invite — the share-link path for people outside the graph. */}
        <View style={styles.inviteCard}>
          <Text variant="heading" style={styles.inviteTitle}>
            Add a friend
          </Text>
          <Text variant="caption" tone="muted">
            {Platform.OS === "web"
              ? "Generate a link and send it however you like. Whoever opens it and taps Accept becomes your friend."
              : "Generate a link and share it. Whoever opens it and taps Accept becomes your friend."}
          </Text>
          <Button
            label={Platform.OS === "web" ? "Create invite link" : "Invite a friend"}
            onPress={() => inviteMutation.mutate()}
            loading={inviteMutation.isPending}
            disabled={inviteMutation.isPending}
            testID="friends-invite-button"
          />
          {inviteUrl ? (
            <>
              <View style={styles.inviteUrlRow}>
                <View style={styles.inviteUrlField}>
                  <Text
                    variant="caption"
                    tone="secondary"
                    numberOfLines={1}
                    testID="friends-invite-url"
                  >
                    {inviteUrl}
                  </Text>
                </View>
                <Button
                  label="Copy"
                  variant="secondary"
                  size="md"
                  onPress={onCopy}
                  testID="friends-invite-copy"
                />
              </View>
              <View style={styles.resetRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reset invite link"
                  onPress={onReset}
                  disabled={resetMutation.isPending}
                  testID="friends-invite-reset"
                  hitSlop={8}
                  style={({ pressed }) => [pressed && styles.resetPressed]}
                >
                  <Text variant="caption" tone="muted" style={styles.resetLabel}>
                    {resetMutation.isPending ? "Resetting…" : "Reset link"}
                  </Text>
                </Pressable>
                <Text variant="caption" tone="muted">
                  Makes the current link stop working.
                </Text>
              </View>
            </>
          ) : null}
        </View>

        {/* Pending inbound requests. */}
        {inbound.length > 0 ? (
          <View style={styles.list} testID="friend-requests-section">
            <Text variant="caption" tone="muted" style={styles.listLabel}>
              {inbound.length === 1 ? "1 friend request" : `${inbound.length} friend requests`}
            </Text>
            {inbound.map((request) => {
              const answering = answeringIds.includes(request.userId);
              return (
                <Pressable
                  key={request.userId}
                  onPress={() => openProfile(request.userId)}
                  accessibilityLabel={`View ${request.displayName?.trim() || "their"} profile`}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.friendRow,
                    (pressed || hovered) && styles.friendRowHover,
                  ]}
                  testID={`friend-request-row-${request.userId}`}
                >
                  <Avatar
                    name={request.displayName}
                    imageUrl={userAvatarImageUrl(request.userId)}
                    size="md"
                  />
                  <View style={styles.friendText}>
                    <Text variant="label" numberOfLines={1} style={styles.friendName}>
                      {request.displayName?.trim() || "Someone"}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      Wants to be friends · {formatRelative(request.requestedAt)}
                    </Text>
                  </View>
                  {answering ? (
                    <ActivityIndicator size="small" color={tokens.accent.default} />
                  ) : (
                    <>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Accept ${request.displayName?.trim() || "request"}`}
                        onPress={() => acceptRequestMutation.mutate(request.userId)}
                        testID={`friend-request-accept-${request.userId}`}
                        hitSlop={6}
                        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                          styles.acceptBtn,
                          (pressed || hovered) && styles.acceptBtnHover,
                        ]}
                      >
                        <Text style={styles.acceptLabel}>Accept</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Decline ${request.displayName?.trim() || "request"}`}
                        onPress={() => denyRequestMutation.mutate(request.userId)}
                        testID={`friend-request-deny-${request.userId}`}
                        hitSlop={6}
                        style={({ pressed }) => [
                          styles.removeBtn,
                          pressed && styles.removeBtnPressed,
                        ]}
                      >
                        <Text style={styles.removeLabel}>Decline</Text>
                      </Pressable>
                    </>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Friends list. */}
        {friendsQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : friendsQuery.isError ? (
          <View style={styles.center}>
            <EmptyState
              title="Couldn't load friends"
              description={errorMessage(friendsQuery.error)}
              action={
                <Button label="Retry" variant="secondary" onPress={() => friendsQuery.refetch()} />
              }
            />
          </View>
        ) : friends.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              title="No friends yet"
              description="Share an invite link to start comparing daily scores with friends."
            />
          </View>
        ) : (
          <View style={styles.list}>
            <Text variant="caption" tone="muted" style={styles.listLabel}>
              {friends.length === 1 ? "1 friend" : `${friends.length} friends`}
            </Text>
            {friends.map((friend) => (
              <Pressable
                key={friend.userId}
                onPress={() => openProfile(friend.userId)}
                accessibilityLabel={`View ${friend.displayName?.trim() || "friend"}'s profile`}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.friendRow,
                  (pressed || hovered) && styles.friendRowHover,
                ]}
                testID={`friend-row-${friend.userId}`}
              >
                <Avatar
                  name={friend.displayName}
                  imageUrl={userAvatarImageUrl(friend.userId)}
                  size="md"
                />
                <View style={styles.friendText}>
                  <Text variant="label" numberOfLines={1} style={styles.friendName}>
                    {friend.displayName?.trim() || "Someone"}
                  </Text>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    Friends since {formatRelative(friend.friendsSince)}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${friend.displayName?.trim() || "friend"}`}
                  onPress={() => onRemove(friend)}
                  testID={`friend-remove-${friend.userId}`}
                  hitSlop={8}
                  style={({ pressed }) => [styles.removeBtn, pressed && styles.removeBtnPressed]}
                >
                  <Text style={styles.removeLabel}>Remove</Text>
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}

        {/* People you may know — friends of friends, most-connected first. */}
        {mutuals.length > 0 ? (
          <View style={styles.list} testID="friend-mutuals-section">
            <Text variant="caption" tone="muted" style={styles.listLabel}>
              People you may know
            </Text>
            {mutuals.map((mutual) => {
              const requested = outboundIds.has(mutual.userId);
              const requesting = requestingIds.includes(mutual.userId);
              return (
                <Pressable
                  key={mutual.userId}
                  onPress={() => openProfile(mutual.userId)}
                  accessibilityLabel={`View ${mutual.displayName?.trim() || "their"} profile`}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.friendRow,
                    (pressed || hovered) && styles.friendRowHover,
                  ]}
                  testID={`friend-mutual-row-${mutual.userId}`}
                >
                  <Avatar
                    name={mutual.displayName}
                    imageUrl={userAvatarImageUrl(mutual.userId)}
                    size="md"
                  />
                  <View style={styles.friendText}>
                    <Text variant="label" numberOfLines={1} style={styles.friendName}>
                      {mutual.displayName?.trim() || "Someone"}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {mutualLine(mutual)}
                    </Text>
                  </View>
                  {requested ? (
                    <View style={styles.requestedPill} testID={`friend-requested-${mutual.userId}`}>
                      <Text style={styles.requestedText}>Requested</Text>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${mutual.displayName?.trim() || "them"} a friend request`}
                      onPress={() => sendRequestMutation.mutate(mutual.userId)}
                      disabled={requesting}
                      testID={`friend-mutual-add-${mutual.userId}`}
                      hitSlop={6}
                      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                        styles.addBtn,
                        (pressed || hovered) && styles.addBtnHover,
                        requesting && styles.addBtnBusy,
                      ]}
                    >
                      {requesting ? (
                        <ActivityIndicator size="small" color={tokens.accent.default} />
                      ) : (
                        <Text style={styles.addGlyph}>+</Text>
                      )}
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
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
  inviteCard: {
    gap: tokens.space.md,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  inviteTitle: { letterSpacing: -0.2 },
  inviteUrlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  inviteUrlField: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.canvas,
  },
  resetRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.space.sm,
  },
  resetPressed: { opacity: 0.6 },
  resetLabel: {
    color: tokens.status.danger,
    fontWeight: tokens.font.weight.semibold,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xl,
  },
  list: { gap: tokens.space.sm },
  listLabel: { letterSpacing: 0.4, textTransform: "uppercase" },
  friendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  friendRowHover: { backgroundColor: tokens.bg.elevated },
  friendText: { flex: 1, minWidth: 0, gap: 2 },
  friendName: { fontSize: tokens.font.size.md, color: tokens.text.primary },
  removeBtn: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 6,
    borderRadius: tokens.radius.sm,
  },
  removeBtnPressed: { backgroundColor: `${tokens.status.danger}1A` },
  removeLabel: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.status.danger,
  },
  acceptBtn: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: 6,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.accent.muted,
    borderWidth: 1,
    borderColor: `${tokens.accent.default}55`,
  },
  acceptBtnHover: { backgroundColor: `${tokens.accent.default}33` },
  acceptLabel: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.accent.default,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.accent.muted,
    borderWidth: 1,
    borderColor: `${tokens.accent.default}55`,
  },
  addBtnHover: { backgroundColor: `${tokens.accent.default}33` },
  addBtnBusy: { opacity: 0.8 },
  addGlyph: {
    fontSize: 20,
    lineHeight: 24,
    color: tokens.accent.default,
    fontWeight: tokens.font.weight.semibold,
  },
  requestedPill: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: 6,
    borderRadius: tokens.radius.md,
  },
  requestedText: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.text.muted,
  },
});
