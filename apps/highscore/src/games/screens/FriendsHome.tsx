// Friends — invite link, pending requests, your friends, people you may know.
// Reached from the profile menu (avatar in the Home header); every row opens
// that person's profile.

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
import type { MutualSummary } from "@workshop/shared/friends";
import { confirm, haptics } from "@workshop/ui";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ScreenHeader } from "../../components/ScreenHeader";
import { Avatar, Button, Notice, PixelIcon, Screen, Text, tokens, useToast } from "../../theme";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { goBack } from "../lib/navigation";
import { shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";

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
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();
  const openProfile = useOpenProfile();

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
  const friends = friendsQuery.data?.friends ?? [];
  const inbound = requestsQuery.data?.inbound ?? [];
  const outboundIds = new Set((requestsQuery.data?.outbound ?? []).map((r) => r.userId));
  const inboundIds = new Set(inbound.map((r) => r.userId));
  const mutuals = (mutualsQuery.data?.mutuals ?? []).filter((m) => !inboundIds.has(m.userId));

  const invalidateFriendsAndGames = () =>
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
      else if (result === "failed")
        showToast({ message: "Couldn't copy — copy the link below manually.", tone: "danger" });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't create an invite link."), tone: "danger" }),
  });

  const resetMutation = useMutation({
    mutationFn: () => resetFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      setInviteUrl(data.url);
      const result = await shareOrCopyLink(data.url);
      if (result === "copied")
        showToast({ message: "New link copied — the old one no longer works", tone: "success" });
      else if (result === "failed")
        showToast({
          message: "New link created — copy it below. The old one no longer works.",
          tone: "danger",
        });
      else
        showToast({ message: "New link created — the old one no longer works", tone: "success" });
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't reset the invite link."), tone: "danger" }),
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
      await invalidateFriendsAndGames();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't remove that friend."), tone: "danger" }),
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
        await invalidateFriendsAndGames();
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests });
      }
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" }),
    onSettled: (_d, _e, userId) => setRequestingIds((ids) => ids.filter((id) => id !== userId)),
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
      await invalidateFriendsAndGames();
    },
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" }),
    onSettled: (_d, _e, userId) => setAnsweringIds((ids) => ids.filter((id) => id !== userId)),
  });

  const denyRequestMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return removeFriendRequest(userId, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
    onError: (e) =>
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" }),
    onSettled: (_d, _e, userId) => setAnsweringIds((ids) => ids.filter((id) => id !== userId)),
  });

  const onRemove = async (userId: string, name: string) => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      message: "You'll stop seeing each other's scores. You can add them again later.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) unfriendMutation.mutate(userId);
  };

  return (
    <Screen testID="friends-screen">
      <ScreenHeader onBack={() => goBack(routes.home)} backTestID="friends-back" title="Friends" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.invite}>
          <Text variant="heading" style={styles.inviteTitle}>
            Invite a friend
          </Text>
          <Text variant="caption" tone="secondary">
            {Platform.OS === "web"
              ? "Send them your link — opening it adds you both."
              : "Share your link — opening it adds you both."}
          </Text>
          <Button
            label={
              inviteUrl
                ? "Share link again"
                : Platform.OS === "web"
                  ? "Create invite link"
                  : "Invite a friend"
            }
            onPress={() => (inviteUrl ? void shareOrCopyLink(inviteUrl) : inviteMutation.mutate())}
            loading={inviteMutation.isPending}
            testID="friends-invite-button"
          />
          {inviteUrl ? (
            <>
              <Text variant="caption" tone="secondary" selectable testID="friends-invite-url">
                {inviteUrl}
              </Text>
              <View style={styles.inviteRow}>
                <Button
                  label="Copy"
                  variant="secondary"
                  onPress={async () => {
                    const r = await shareOrCopyLink(inviteUrl);
                    if (r === "copied")
                      showToast({ message: "Invite link copied", tone: "success" });
                  }}
                  testID="friends-invite-copy"
                />
                <Button
                  label="Reset link"
                  variant="ghost"
                  onPress={onReset}
                  loading={resetMutation.isPending}
                  testID="friends-invite-reset"
                />
              </View>
            </>
          ) : null}
        </View>

        {inbound.length > 0 ? (
          <View testID="friend-requests-section">
            <SectionLabel
              label={
                inbound.length === 1 ? "1 friend request" : `${inbound.length} friend requests`
              }
            />
            {inbound.map((r) => (
              <PersonRow
                key={r.userId}
                userId={r.userId}
                name={r.displayName}
                caption="Wants to be friends"
                onPress={() => openProfile(r.userId)}
                testID={`friend-request-row-${r.userId}`}
                trailing={
                  <View style={styles.rowActions}>
                    <Button
                      label="Accept"
                      onPress={() => acceptRequestMutation.mutate(r.userId)}
                      loading={answeringIds.includes(r.userId)}
                      testID={`friend-request-accept-${r.userId}`}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Decline"
                      onPress={() => denyRequestMutation.mutate(r.userId)}
                      testID={`friend-request-deny-${r.userId}`}
                      style={styles.iconKey}
                    >
                      <PixelIcon name="close" />
                    </Pressable>
                  </View>
                }
              />
            ))}
          </View>
        ) : null}

        <SectionLabel label={friends.length > 0 ? `Friends · ${friends.length}` : "Friends"} />
        {friendsQuery.isPending ? (
          <ActivityIndicator color={tokens.neon.pink} style={styles.spinner} />
        ) : friendsQuery.isError ? (
          <View style={styles.pad}>
            <Notice
              title="Couldn't load friends"
              description={errorMessage(friendsQuery.error)}
              action={
                <Button
                  label="Retry"
                  variant="secondary"
                  onPress={() => void friendsQuery.refetch()}
                />
              }
            />
          </View>
        ) : friends.length === 0 ? (
          <View style={styles.pad}>
            <Notice
              title="No friends yet"
              description="Share your invite link to start comparing scores."
            />
          </View>
        ) : (
          friends.map((f) => (
            <PersonRow
              key={f.userId}
              userId={f.userId}
              name={f.displayName}
              onPress={() => openProfile(f.userId)}
              testID={`friend-row-${f.userId}`}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${f.displayName ?? "friend"}`}
                  onPress={() => void onRemove(f.userId, f.displayName?.trim() || "them")}
                  testID={`friend-remove-${f.userId}`}
                  style={styles.iconKey}
                >
                  <PixelIcon name="close" size={16} />
                </Pressable>
              }
            />
          ))
        )}

        {mutuals.length > 0 ? (
          <View testID="friend-mutuals-section">
            <SectionLabel label="People you may know" />
            {mutuals.map((m) => (
              <PersonRow
                key={m.userId}
                userId={m.userId}
                name={m.displayName}
                caption={mutualLine(m)}
                onPress={() => openProfile(m.userId)}
                testID={`friend-mutual-row-${m.userId}`}
                trailing={
                  outboundIds.has(m.userId) ? (
                    <Text
                      variant="caption"
                      tone="secondary"
                      testID={`friend-requested-${m.userId}`}
                    >
                      Requested
                    </Text>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${m.displayName ?? "friend"}`}
                      onPress={() => sendRequestMutation.mutate(m.userId)}
                      disabled={requestingIds.includes(m.userId)}
                      testID={`friend-mutual-add-${m.userId}`}
                      style={[styles.iconKey, styles.iconKeyPink]}
                    >
                      {requestingIds.includes(m.userId) ? (
                        <ActivityIndicator size="small" color={tokens.neon.pink} />
                      ) : (
                        <PixelIcon name="plus" color={tokens.neon.pink} />
                      )}
                    </Pressable>
                  )
                }
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <Text variant="heading" tone="secondary" style={styles.section}>
      {label}
    </Text>
  );
}

function PersonRow({
  userId,
  name,
  caption,
  onPress,
  trailing,
  testID,
}: {
  userId: string;
  name: string | null;
  caption?: string;
  onPress: () => void;
  trailing?: ReactNode;
  testID: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name ?? "Someone"}'s profile`}
        onPress={onPress}
        style={({ pressed }) => [styles.rowBody, pressed && styles.rowPressed]}
      >
        <Avatar name={name} imageUrl={userAvatarImageUrl(userId)} size="md" />
        <View style={styles.rowText}>
          <Text variant="label" numberOfLines={1}>
            {name?.trim() || "Someone"}
          </Text>
          {caption ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {caption}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {trailing ? <View style={styles.rowTrailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: tokens.space.xxl },
  pad: { paddingHorizontal: tokens.space.lg },
  spinner: { paddingVertical: tokens.space.lg },
  invite: {
    margin: tokens.space.lg,
    padding: tokens.space.md,
    gap: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.surface,
  },
  inviteTitle: { fontSize: 11, lineHeight: 16 },
  inviteRow: { flexDirection: "row", gap: tokens.space.sm },
  section: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xs,
    fontSize: 9,
    lineHeight: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 56,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.bg.elevated,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
    paddingLeft: tokens.space.lg,
  },
  rowPressed: { backgroundColor: tokens.bg.surface },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTrailing: { paddingRight: tokens.space.lg },
  rowActions: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  iconKey: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  iconKeyPink: { borderColor: tokens.neon.pink },
});
