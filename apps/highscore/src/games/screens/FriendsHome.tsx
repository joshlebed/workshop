// Players — the friend graph.
//
// Three sections in one ledger: inbound requests, your players, and people you
// may know. No invite card sitting at the top taking a third of the screen —
// inviting is a dock key, and the minted link only appears once there's a link
// to show. Row actions stay on the row; navigation stays in the dock.

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
import { type Href, useRouter } from "expo-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { DOCK_HEIGHT, type DockKey, useDock } from "../../nav/dock";
import { Avatar } from "../../theme/Avatar";
import { Button } from "../../theme/Button";
import { EmptyState } from "../../theme/EmptyState";
import { Screen } from "../../theme/layout";
import { PixelIcon } from "../../theme/PixelIcon";
import { Text } from "../../theme/Text";
import { useToast } from "../../theme/Toast";
import { tokens } from "../../theme/tokens";
import { fetchMyGames } from "../api/games";
import { localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { copyToClipboard, shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";

const RAIL = 42;

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
  // Today's standings are already in cache from the board; reusing them turns
  // the right side of each player row into a live "have they played" signal
  // instead of empty space.
  const todayKey = localDateKey();
  const todayQuery = useQuery({
    queryKey: queryKeys.games.mine(todayKey),
    queryFn: () => fetchMyGames(todayKey, token),
    enabled,
    refetchInterval: livePoll,
  });
  const postedToday = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of todayQuery.data?.games ?? []) {
      for (const e of g.standings.entries) {
        if (!e.scoreRaw) continue;
        counts.set(e.userId, (counts.get(e.userId) ?? 0) + 1);
      }
    }
    return counts;
  }, [todayQuery.data]);

  const friends = friendsQuery.data?.friends ?? [];
  const inbound = requestsQuery.data?.inbound ?? [];
  const outboundIds = new Set((requestsQuery.data?.outbound ?? []).map((r) => r.userId));
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

  const openProfile = (userId: string) => router.push(routes.friendProfile(userId) as Href);

  const back = useCallback(() => goBack(routes.home), [routes.home]);
  const invitePending = inviteMutation.isPending;
  const dockKeys = useMemo<DockKey[]>(() => {
    const keys: DockKey[] = [
      {
        id: "invite",
        label: "Invite",
        glyph: "link",
        tone: "primary",
        weight: 1.5,
        disabled: invitePending,
        onPress: () => inviteMutation.mutate(),
        testID: "friends-invite-button",
        accessibilityLabel: "Create a share-link invite",
      },
    ];
    if (inviteUrl) {
      keys.push({
        id: "copy",
        label: "Copy",
        glyph: "copy",
        onPress: () => {
          void (async () => {
            const ok = await copyToClipboard(inviteUrl);
            showToast({
              message: ok ? "Invite link copied" : "Couldn't copy to clipboard",
              tone: ok ? "success" : "danger",
            });
          })();
        },
        testID: "friends-invite-copy",
      });
    }
    keys.push({
      id: "back",
      label: "Back",
      glyph: "arrow-left",
      weight: 0.7,
      onPress: back,
      testID: "friends-back",
    });
    return keys;
  }, [invitePending, inviteMutation, inviteUrl, back, showToast]);
  useDock(dockKeys);

  return (
    <Screen testID="friends-screen">
      <View style={styles.header}>
        <Text variant="title" style={styles.headerTitle}>
          Players
        </Text>
        {invitePending ? <ActivityIndicator size="small" color={tokens.neon.pink} /> : null}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {inviteUrl ? (
          <View style={styles.inviteStrip} testID="friends-invite-strip">
            <Text variant="caption" tone="secondary" numberOfLines={1} testID="friends-invite-url">
              {inviteUrl}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset invite link"
              onPress={onReset}
              disabled={resetMutation.isPending}
              testID="friends-invite-reset"
              hitSlop={8}
              style={({ pressed }) => [pressed && styles.resetPressed]}
            >
              <Text variant="heading" tone="danger" style={styles.resetLabel}>
                {resetMutation.isPending ? "…" : "Reset"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {inbound.length > 0 ? (
          <Section
            label={inbound.length === 1 ? "1 request" : `${inbound.length} requests`}
            testID="friend-requests-section"
          >
            {inbound.map((request) => {
              const answering = answeringIds.includes(request.userId);
              const name = request.displayName?.trim() || "Someone";
              return (
                <PersonRow
                  key={request.userId}
                  userId={request.userId}
                  displayName={request.displayName}
                  sub={`wants in · ${formatRelative(request.requestedAt)}`}
                  onPress={() => openProfile(request.userId)}
                  testID={`friend-request-row-${request.userId}`}
                >
                  {answering ? (
                    <ActivityIndicator size="small" color={tokens.neon.pink} />
                  ) : (
                    <>
                      <RowKey
                        glyph="check"
                        tone="primary"
                        label={`Accept ${name}`}
                        onPress={() => acceptRequestMutation.mutate(request.userId)}
                        testID={`friend-request-accept-${request.userId}`}
                      />
                      <RowKey
                        glyph="close"
                        label={`Decline ${name}`}
                        onPress={() => denyRequestMutation.mutate(request.userId)}
                        testID={`friend-request-deny-${request.userId}`}
                      />
                    </>
                  )}
                </PersonRow>
              );
            })}
          </Section>
        ) : null}

        {friendsQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        ) : friendsQuery.isError ? (
          <View style={styles.center}>
            <EmptyState
              title="Can't reach the graph"
              description={errorMessage(friendsQuery.error)}
              action={
                <Button label="Retry" variant="secondary" onPress={() => friendsQuery.refetch()} />
              }
            />
          </View>
        ) : friends.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              title="No players yet"
              description="Send an invite link. Whoever opens it and accepts starts sharing scores with you."
            />
          </View>
        ) : (
          <Section label={friends.length === 1 ? "1 player" : `${friends.length} players`}>
            {friends.map((friend) => (
              <PersonRow
                key={friend.userId}
                userId={friend.userId}
                displayName={friend.displayName}
                sub={`since ${formatRelative(friend.friendsSince)}`}
                onPress={() => openProfile(friend.userId)}
                testID={`friend-row-${friend.userId}`}
              >
                <TodayCount count={postedToday.get(friend.userId) ?? 0} />
              </PersonRow>
            ))}
          </Section>
        )}

        {mutuals.length > 0 ? (
          <Section label="You may know" testID="friend-mutuals-section">
            {mutuals.map((mutual) => {
              const requested = outboundIds.has(mutual.userId);
              const requesting = requestingIds.includes(mutual.userId);
              return (
                <PersonRow
                  key={mutual.userId}
                  userId={mutual.userId}
                  displayName={mutual.displayName}
                  sub={mutualLine(mutual)}
                  onPress={() => openProfile(mutual.userId)}
                  testID={`friend-mutual-row-${mutual.userId}`}
                >
                  {requested ? (
                    <Text
                      variant="heading"
                      tone="secondary"
                      style={styles.requested}
                      testID={`friend-requested-${mutual.userId}`}
                    >
                      Sent
                    </Text>
                  ) : requesting ? (
                    <ActivityIndicator size="small" color={tokens.neon.pink} />
                  ) : (
                    <RowKey
                      glyph="user-plus"
                      tone="primary"
                      label={`Send ${mutual.displayName?.trim() || "them"} a friend request`}
                      onPress={() => sendRequestMutation.mutate(mutual.userId)}
                      testID={`friend-mutual-add-${mutual.userId}`}
                    />
                  )}
                </PersonRow>
              );
            })}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Section({
  label,
  children,
  testID,
}: {
  label: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View testID={testID}>
      <View style={styles.sectionHeader}>
        <Text variant="heading" tone="secondary" style={styles.sectionLabel}>
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

/**
 * The name+avatar half is the tap target; row actions sit beside it, never
 * inside it — react-native-web turns an `accessibilityRole="button"` View into
 * a real <button>, and a button inside a button is invalid DOM.
 */
function PersonRow({
  userId,
  displayName,
  sub,
  onPress,
  children,
  testID,
}: {
  userId: string;
  displayName: string | null;
  sub: string;
  onPress: () => void;
  children?: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${displayName?.trim() || "their"} profile`}
        onPress={onPress}
        testID={testID}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.rowMain,
          (pressed || hovered) && styles.rowActive,
        ]}
      >
        <View style={styles.rail}>
          <Avatar name={displayName} imageUrl={userAvatarImageUrl(userId)} size="sm" />
        </View>
        <View style={styles.rowText}>
          <Text variant="label" numberOfLines={1} style={styles.rowName}>
            {displayName?.trim() || "Someone"}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {sub}
          </Text>
        </View>
      </Pressable>
      {children}
    </View>
  );
}

/** How many of your games this player has posted to today. */
function TodayCount({ count }: { count: number }) {
  return (
    <View style={styles.todayCount}>
      <Text variant="score" tone={count > 0 ? "primary" : "secondary"} style={styles.todayValue}>
        {count > 0 ? String(count) : "—"}
      </Text>
      <Text variant="heading" tone="secondary" style={styles.todayLabel}>
        Today
      </Text>
    </View>
  );
}

function RowKey({
  glyph,
  label,
  onPress,
  tone,
  testID,
}: {
  glyph: "check" | "close" | "trash" | "user-plus";
  label: string;
  onPress: () => void;
  tone?: "primary" | "danger";
  testID: string;
}) {
  const color =
    tone === "primary"
      ? tokens.neon.pink
      : tone === "danger"
        ? tokens.status.danger
        : tokens.text.secondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      hitSlop={4}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.rowKey,
        tone === "primary" && styles.rowKeyPrimary,
        (pressed || hovered) && styles.rowKeyActive,
      ]}
    >
      <PixelIcon name={glyph} size={16} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.md,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  headerTitle: { fontSize: 14 },
  body: { paddingBottom: DOCK_HEIGHT + tokens.space.xl },
  inviteStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    backgroundColor: tokens.bg.surface,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  resetPressed: { opacity: 0.6 },
  resetLabel: { fontSize: 10 },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: tokens.space.xxl },
  sectionHeader: {
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.sm,
  },
  sectionLabel: { fontSize: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingRight: tokens.space.md,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: tokens.space.md,
  },
  rowActive: { backgroundColor: tokens.bg.surface },
  rail: {
    width: RAIL,
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  rowText: { flex: 1, minWidth: 0, paddingLeft: tokens.space.md, gap: tokens.space.xs },
  rowName: { color: tokens.text.primary },
  rowKey: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  rowKeyPrimary: { borderColor: tokens.neon.pink },
  rowKeyActive: { backgroundColor: tokens.bg.raised },
  requested: { fontSize: 10 },
  todayCount: { alignItems: "center", gap: tokens.space.xs, minWidth: 40 },
  todayValue: { fontSize: 14, lineHeight: 18 },
  todayLabel: { fontSize: 10, lineHeight: 12 },
});
