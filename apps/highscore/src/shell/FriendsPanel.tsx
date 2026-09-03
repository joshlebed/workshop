// Drawer panel 1 — requests, friends, people you may know, and the invite
// link. Same graph and the same `@workshop/api-client/friends` boundary the
// old full-screen Friends route used; it just never leaves the ledger.

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
} from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import type { MutualSummary } from "@workshop/shared/friends";
import { confirm, formatRelative, haptics } from "@workshop/ui";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { shareOrCopyLink } from "../games/lib/share";
import { useGamesRuntime } from "../games/runtime";
import { Avatar, Button, PixelIcon, pixelType, tokens, useToast } from "../theme";
import { Text } from "../theme/Text";

/** "1 mutual friend · Alice" / "2 mutual friends · Alice & Bob" / "+N". */
export function mutualLine(m: MutualSummary): string {
  const names = m.mutualFriends.map((f) => f.displayName?.trim() || "Someone");
  const count = m.mutualCount === 1 ? "1 mutual friend" : `${m.mutualCount} mutual friends`;
  if (names.length === 0) return count;
  if (names.length === 1) return `${count} · ${names[0]}`;
  if (names.length === 2) return `${count} · ${names[0]} & ${names[1]}`;
  return `${count} · ${names[0]}, ${names[1]} +${names.length - 2}`;
}

export interface FriendSignal {
  played: number;
  leads: number;
}

export interface FriendsPanelProps {
  /** Today's play count and wins per user, keyed by userId. */
  signals: Map<string, FriendSignal>;
  onClose: () => void;
  onOpenFriend: (userId: string) => void;
}

/** "4 played · leads 2" — what this person has done on the board today. */
function signalLine(signal: FriendSignal | undefined): string {
  if (!signal || signal.played === 0) return "Nothing today";
  const played = `${signal.played} played`;
  return signal.leads > 0 ? `${played} · leads ${signal.leads}` : played;
}

export function FriendsPanel({ signals, onClose, onOpenFriend }: FriendsPanelProps) {
  const { token } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
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

  // Sorted by what they did today, not alphabetically: the people you're
  // actually racing float to the top of the list.
  const friends = [...(friendsQuery.data?.friends ?? [])].sort((a, b) => {
    const sa = signals.get(a.userId);
    const sb = signals.get(b.userId);
    return (
      (sb?.leads ?? 0) - (sa?.leads ?? 0) ||
      (sb?.played ?? 0) - (sa?.played ?? 0) ||
      (a.displayName ?? "").localeCompare(b.displayName ?? "")
    );
  });
  const inbound = requestsQuery.data?.inbound ?? [];
  const outboundIds = new Set((requestsQuery.data?.outbound ?? []).map((r) => r.userId));
  const inboundIds = new Set(inbound.map((r) => r.userId));
  const mutuals = (mutualsQuery.data?.mutuals ?? []).filter((m) => !inboundIds.has(m.userId));

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
      queryClient.invalidateQueries({ queryKey: ["games"] }),
    ]);

  const inviteMutation = useMutation({
    mutationFn: () => createFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      setInviteUrl(data.url);
      const result = await shareOrCopyLink(data.url);
      if (result === "copied") showToast({ message: "Invite link copied", tone: "success" });
      else if (result === "failed") {
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
      showToast({
        message:
          result === "copied"
            ? "New link copied — the old one no longer works"
            : "New link created — the old one no longer works",
        tone: result === "failed" ? "danger" : "success",
      });
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
        await invalidateAll();
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" });
    },
    onSettled: (_d, _e, userId) => setRequestingIds((ids) => ids.filter((id) => id !== userId)),
  });

  const acceptMutation = useMutation({
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
      await invalidateAll();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" });
    },
    onSettled: (_d, _e, userId) => setAnsweringIds((ids) => ids.filter((id) => id !== userId)),
  });

  const denyMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return removeFriendRequest(userId, token);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" });
    },
    onSettled: (_d, _e, userId) => setAnsweringIds((ids) => ids.filter((id) => id !== userId)),
  });

  return (
    <View style={styles.panel} testID="friends-screen">
      <View style={styles.head}>
        <Text style={styles.headTitle}>FRIENDS</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close friends"
          onPress={onClose}
          hitSlop={10}
          testID="friends-close"
          style={({ pressed }) => [styles.headBtn, pressed && styles.dim]}
        >
          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {inbound.length > 0 ? (
          <View style={styles.section} testID="friend-requests-section">
            <Text style={styles.sectionLabel}>REQUESTS</Text>
            {inbound.map((request) => {
              const answering = answeringIds.includes(request.userId);
              const name = request.displayName?.trim() || "Someone";
              return (
                <View key={request.userId} style={styles.person}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${name}'s profile`}
                    onPress={() => onOpenFriend(request.userId)}
                    testID={`friend-request-row-${request.userId}`}
                    style={({ pressed }) => [styles.personMain, pressed && styles.dim]}
                  >
                    <Avatar
                      name={request.displayName}
                      imageUrl={userAvatarImageUrl(request.userId)}
                      size="md"
                    />
                    <View style={styles.personText}>
                      <Text numberOfLines={1} style={styles.personName}>
                        {name}
                      </Text>
                      <Text numberOfLines={1} style={styles.personMeta}>
                        Wants to be friends · {formatRelative(request.requestedAt)}
                      </Text>
                    </View>
                  </Pressable>
                  {answering ? (
                    <ActivityIndicator size="small" color={tokens.neon.pink} />
                  ) : (
                    <View style={styles.personActions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Accept ${name}`}
                        onPress={() => acceptMutation.mutate(request.userId)}
                        hitSlop={6}
                        testID={`friend-request-accept-${request.userId}`}
                        style={({ pressed }) => [pressed && styles.dim]}
                      >
                        <Text style={styles.accept}>ACCEPT</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Decline ${name}`}
                        onPress={() => denyMutation.mutate(request.userId)}
                        hitSlop={6}
                        testID={`friend-request-deny-${request.userId}`}
                        style={({ pressed }) => [pressed && styles.dim]}
                      >
                        <Text style={styles.decline}>DECLINE</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.section}>
          {friendsQuery.isPending ? (
            <ActivityIndicator color={tokens.neon.pink} style={styles.spinner} />
          ) : friendsQuery.isError ? (
            <View style={styles.errorBlock}>
              <Text style={styles.personMeta}>{errorMessage(friendsQuery.error)}</Text>
              <Button label="Retry" variant="secondary" onPress={() => friendsQuery.refetch()} />
            </View>
          ) : friends.length === 0 ? (
            <Text style={styles.personMeta}>
              Nobody yet. Send an invite link and start comparing scores.
            </Text>
          ) : (
            friends.map((friend) => {
              const name = friend.displayName?.trim() || "Someone";
              return (
                <Pressable
                  key={friend.userId}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${name}'s profile`}
                  onPress={() => onOpenFriend(friend.userId)}
                  testID={`friend-row-${friend.userId}`}
                  style={({ pressed }) => [styles.person, pressed && styles.dim]}
                >
                  {/* The "friends since" date and a chevron on every row were
                      twelve repetitions of nothing; what belongs here is what
                      they've done on today's board. */}
                  <View style={styles.personMain}>
                    <Avatar
                      name={friend.displayName}
                      imageUrl={userAvatarImageUrl(friend.userId)}
                      size="md"
                    />
                    <View style={styles.personText}>
                      <Text numberOfLines={1} style={styles.personName}>
                        {name}
                      </Text>
                      <Text numberOfLines={1} style={styles.personMeta}>
                        {signalLine(signals.get(friend.userId))}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        {mutuals.length > 0 ? (
          <View style={styles.section} testID="friend-mutuals-section">
            <Text style={styles.sectionLabel}>YOU MAY KNOW</Text>
            {mutuals.map((mutual) => {
              const name = mutual.displayName?.trim() || "Someone";
              const requested = outboundIds.has(mutual.userId);
              const requesting = requestingIds.includes(mutual.userId);
              return (
                <View key={mutual.userId} style={styles.person}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${name}'s profile`}
                    onPress={() => onOpenFriend(mutual.userId)}
                    testID={`friend-mutual-row-${mutual.userId}`}
                    style={({ pressed }) => [styles.personMain, pressed && styles.dim]}
                  >
                    <Avatar
                      name={mutual.displayName}
                      imageUrl={userAvatarImageUrl(mutual.userId)}
                      size="md"
                    />
                    <View style={styles.personText}>
                      <Text numberOfLines={1} style={styles.personName}>
                        {name}
                      </Text>
                      <Text numberOfLines={1} style={styles.personMeta}>
                        {mutualLine(mutual)}
                      </Text>
                    </View>
                  </Pressable>
                  {requested ? (
                    <Text style={styles.requested} testID={`friend-requested-${mutual.userId}`}>
                      SENT
                    </Text>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${name} a friend request`}
                      onPress={() => sendRequestMutation.mutate(mutual.userId)}
                      disabled={requesting}
                      hitSlop={6}
                      testID={`friend-mutual-add-${mutual.userId}`}
                      style={({ pressed }) => [pressed && styles.dim]}
                    >
                      {requesting ? (
                        <ActivityIndicator size="small" color={tokens.neon.pink} />
                      ) : (
                        <Text style={styles.accept}>ADD</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.invite}>
          <Button
            label="Invite a friend"
            onPress={() => inviteMutation.mutate()}
            loading={inviteMutation.isPending}
            disabled={inviteMutation.isPending}
            testID="friends-invite-button"
          />
          {inviteUrl ? (
            <>
              <Text numberOfLines={1} style={styles.inviteUrl} testID="friends-invite-url">
                {inviteUrl}
              </Text>
              <View style={styles.inviteActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy invite link"
                  onPress={() => void shareOrCopyLink(inviteUrl)}
                  hitSlop={6}
                  testID="friends-invite-copy"
                  style={({ pressed }) => [pressed && styles.dim]}
                >
                  <Text style={styles.accept}>COPY</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reset invite link"
                  onPress={onReset}
                  disabled={resetMutation.isPending}
                  hitSlop={6}
                  testID="friends-invite-reset"
                  style={({ pressed }) => [pressed && styles.dim]}
                >
                  <Text style={styles.decline}>
                    {resetMutation.isPending ? "RESETTING" : "RESET LINK"}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
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
  headTitle: { ...pixelType(13), color: tokens.text.primary },
  headBtn: { width: 32, height: 32, alignItems: "flex-end", justifyContent: "center" },
  body: { paddingBottom: tokens.space.xxl * 2 },
  dim: { opacity: 0.6 },
  section: { paddingTop: tokens.space.lg },
  sectionLabel: {
    ...pixelType(10),
    color: tokens.text.secondary,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xs,
  },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.sm,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
  },
  personMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  personText: { flex: 1, minWidth: 0, gap: 2 },
  personName: { fontSize: 14, lineHeight: 18, color: tokens.text.primary },
  personMeta: { fontSize: 11, lineHeight: 15, color: tokens.text.secondary },
  personActions: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  accept: { ...pixelType(10), color: tokens.neon.pink },
  decline: { ...pixelType(10), color: tokens.text.secondary },
  requested: { ...pixelType(10), color: tokens.border.default },
  spinner: { paddingVertical: tokens.space.xl },
  errorBlock: { gap: tokens.space.sm, paddingHorizontal: tokens.space.lg },
  invite: {
    gap: tokens.space.sm,
    padding: tokens.space.lg,
    marginTop: tokens.space.lg,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  inviteUrl: {
    fontSize: 11,
    lineHeight: 15,
    color: tokens.text.secondary,
    borderWidth: 1,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 6,
  },
  inviteActions: { flexDirection: "row", gap: tokens.space.lg },
});
