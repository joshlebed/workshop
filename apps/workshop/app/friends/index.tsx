import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FriendSummary } from "@workshop/shared/friends";
import { Redirect } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { createFriendInvite, fetchFriends, unfriend } from "../../src/api/friends";
import { useAuth } from "../../src/hooks/useAuth";
import { useLivePollingInterval } from "../../src/hooks/useLivePollingInterval";
import { errorMessage } from "../../src/lib/api";
import { confirm } from "../../src/lib/confirm";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import { goBack } from "../../src/lib/goBack";
import { haptics } from "../../src/lib/haptics";
import { queryKeys } from "../../src/lib/queryKeys";
import { formatRelative } from "../../src/lib/relativeTime";
import { shareOrCopyLink } from "../../src/lib/share";
import { Avatar, Button, EmptyState, Screen, Text, tokens, useToast } from "../../src/ui/index";

/**
 * Friends screen (G2b, issue #286) — the share-link friend graph behind the
 * Games surface flag. Reachable from the Games header and the profile/settings
 * sheet. Share-link is the only friend-add mechanism in v1 (no search/QR —
 * decided 2026-06-10).
 *
 * Incoming requests are *not* listed here: the share-link model has no directed
 * pending request until someone opens a link, so accepting happens on the
 * accept-landing route (`/friends/accept/:token`), which previews the inviter
 * and forms the edge.
 */
export default function FriendsScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const livePoll = useLivePollingInterval();

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token && GAMES_TAB_ENABLED,
    refetchInterval: livePoll,
  });
  const friends = friendsQuery.data?.friends ?? [];

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

  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }

  const onCopy = async () => {
    if (!inviteUrl) return;
    const ok = await shareOrCopyLink(inviteUrl);
    if (ok === "copied") showToast({ message: "Invite link copied", tone: "success" });
  };

  return (
    <Screen testID="friends-screen">
      <View style={styles.headerNav}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => goBack("/games")}
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
        {/* Invite — share-link is the only add path in v1. */}
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
          ) : null}
        </View>

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
              <View
                key={friend.userId}
                style={styles.friendRow}
                testID={`friend-row-${friend.userId}`}
              >
                <Avatar name={friend.displayName} size="md" />
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
              </View>
            ))}
          </View>
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
});
