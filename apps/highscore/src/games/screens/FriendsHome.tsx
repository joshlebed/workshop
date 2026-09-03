// FRIENDS — the social graph, as opposed to the PLAYERS projection on TODAY
// (which is scores). Requests first because they're the only thing here that's
// waiting on you, then your friends, then people you may know.
//
// The invite pitch used to be a bordered card with two paragraphs and a URL
// field permanently taking the top third of the screen. It's now one key in the
// header; the link only appears once there's a link to show.

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
import { type ReactNode, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { type Measurable, useFlight } from "../../components/Flight";
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
import { fetchMyGames } from "../api/games";
import { localDateKey } from "../lib/gameDate";
import { buildPlayerRows, type PlayerRow } from "../lib/matrix";
import { shareOrCopyLink } from "../lib/share";
import { useGamesRuntime } from "../runtime";

/** "5 of 9 today · 2 firsts" — what a rival row is actually for. */
function friendMeta(row: PlayerRow): string {
  if (row.playedCount === 0) return "Nothing today";
  const played = `${row.playedCount} of ${row.cells.length} today`;
  if (row.firsts === 0) return played;
  return `${played} · ${row.firsts === 1 ? "1 first" : `${row.firsts} firsts`}`;
}

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
  const { token, user, routes } = useGamesRuntime();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { fly } = useFlight();
  const livePoll = useLivePollingInterval();

  const todayKey = localDateKey();
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

  const invalidateGraph = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
      // Friendship gates score visibility, so the board must re-fetch too.
      queryClient.invalidateQueries({ queryKey: ["games"] }),
    ]);

  const sendRequestMutation = useMutation({
    mutationFn: (userId: string) => {
      setRequestingIds((ids) => [...ids, userId]);
      return sendFriendRequest(userId, token);
    },
    onSuccess: async (data) => {
      haptics.medium();
      if (data.status === "accepted") {
        showToast({
          message: `You're now playing with ${data.friend?.displayName?.trim() || "them"}`,
          tone: "success",
        });
        await invalidateGraph();
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
        message: `You're now playing with ${data.friend.displayName?.trim() || "them"}`,
        tone: "success",
      });
      await invalidateGraph();
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

  // A friends list in a competition app that shows only names is a phonebook.
  // Today's grid is already cached by TODAY, so the per-row signal is free.
  const gamesQuery = useQuery({
    queryKey: queryKeys.games.mine(todayKey),
    queryFn: () => fetchMyGames(todayKey, token),
    enabled,
    refetchInterval: livePoll,
  });
  const rankedFriends = buildPlayerRows({
    games: gamesQuery.data?.games ?? [],
    friends,
    selfId: user?.id ?? null,
    selfName: user?.displayName ?? null,
  }).filter((row) => !row.isSelf);

  const openProfile = (userId: string, displayName: string | null, source: Measurable | null) => {
    fly({
      source,
      node: <Avatar name={displayName} imageUrl={userAvatarImageUrl(userId)} size="lg" />,
      navigate: () => router.push(routes.friendProfile(userId) as Href),
    });
  };

  return (
    <Screen testID="friends-screen">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="title">Friends</Text>
          {friends.length > 0 ? (
            <Text variant="caption" tone="secondary">
              {friends.length === 1 ? "1 friend" : `${friends.length} friends`}
            </Text>
          ) : null}
        </View>
        <Button
          label={inviteUrl ? "New link" : "Invite"}
          pixel
          size="sm"
          onPress={() => (inviteUrl ? onReset() : inviteMutation.mutate())}
          loading={inviteMutation.isPending || resetMutation.isPending}
          testID="friends-invite-button"
        />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {inviteUrl ? (
          <View style={styles.inviteBlock} testID="friends-invite-block">
            <Text variant="caption" tone="secondary">
              Anyone who opens this and taps Accept starts sharing scores with you. "New link"
              retires it.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy the invite link"
              onPress={async () => {
                const ok = await shareOrCopyLink(inviteUrl);
                if (ok === "copied") showToast({ message: "Invite link copied", tone: "success" });
              }}
              testID="friends-invite-copy"
              style={({ pressed }) => [styles.inviteUrl, pressed && styles.rowPressed]}
            >
              <Text variant="mono" tone="secondary" numberOfLines={1} testID="friends-invite-url">
                {inviteUrl}
              </Text>
              <PixelIcon name="copy" size={16} color={tokens.neon.pink} />
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
                  meta={`Asked ${formatRelative(request.requestedAt)}`}
                  onOpen={openProfile}
                  highlight
                  testID={`friend-request-row-${request.userId}`}
                  trailing={
                    answering ? (
                      <ActivityIndicator size="small" color={tokens.neon.pink} />
                    ) : (
                      <View style={styles.answerPair}>
                        <Button
                          label="Accept"
                          pixel
                          size="sm"
                          onPress={() => acceptRequestMutation.mutate(request.userId)}
                          testID={`friend-request-accept-${request.userId}`}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Decline ${name}`}
                          onPress={() => denyRequestMutation.mutate(request.userId)}
                          testID={`friend-request-deny-${request.userId}`}
                          hitSlop={8}
                          style={({ pressed }) => [styles.quietKey, pressed && styles.rowPressed]}
                        >
                          <PixelIcon name="close" size={16} color={tokens.text.secondary} />
                        </Pressable>
                      </View>
                    )
                  }
                />
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
              title="Can't load friends"
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
              description="Send an invite link and today's grid stops being a column of one."
            />
          </View>
        ) : (
          <View>
            {rankedFriends.map((row) => (
              <PersonRow
                key={row.userId}
                userId={row.userId}
                displayName={row.displayName}
                meta={friendMeta(row)}
                onOpen={openProfile}
                testID={`friend-row-${row.userId}`}
                {...(row.isLeader
                  ? { trailing: <PixelIcon name="crown" size={16} color={tokens.neon.yellow} /> }
                  : {})}
              />
            ))}
          </View>
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
                  meta={mutualLine(mutual)}
                  onOpen={openProfile}
                  testID={`friend-mutual-row-${mutual.userId}`}
                  trailing={
                    requested ? (
                      <Text
                        variant="caption"
                        tone="secondary"
                        testID={`friend-requested-${mutual.userId}`}
                      >
                        Asked
                      </Text>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Ask ${mutual.displayName?.trim() || "them"} to play`}
                        onPress={() => sendRequestMutation.mutate(mutual.userId)}
                        disabled={requesting}
                        testID={`friend-mutual-add-${mutual.userId}`}
                        hitSlop={6}
                        style={({ pressed }) => [styles.addKey, pressed && styles.rowPressed]}
                      >
                        {requesting ? (
                          <ActivityIndicator size="small" color={tokens.neon.pink} />
                        ) : (
                          <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
                        )}
                      </Pressable>
                    )
                  }
                />
              );
            })}
          </Section>
        ) : null}
      </ScrollView>

      <KeyPanel active="friends" pending={inbound.length} />
    </Screen>
  );

  async function onReset() {
    const ok = await confirm({
      title: "Retire this invite link?",
      message: "Anyone you've already sent it to won't be able to use it.",
      confirmLabel: "New link",
      destructive: true,
    });
    if (ok) resetMutation.mutate();
  }
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
    <View style={styles.section} testID={testID}>
      <Text variant="eyebrow" tone="secondary" style={styles.sectionLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function PersonRow({
  userId,
  displayName,
  meta,
  trailing,
  onOpen,
  highlight = false,
  testID,
}: {
  userId: string;
  displayName: string | null;
  /** Second line. Omitted on the plain friends list — a name is the row. */
  meta?: string;
  trailing?: ReactNode;
  onOpen: (userId: string, displayName: string | null, source: Measurable | null) => void;
  highlight?: boolean;
  testID: string;
}) {
  const avatarRef = useRef<View>(null);
  const name = displayName?.trim() || "Someone";
  return (
    <View style={[styles.row, highlight && styles.rowHighlight]} testID={testID}>
      <View ref={avatarRef}>
        <Avatar name={displayName} imageUrl={userAvatarImageUrl(userId)} size="md" />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}'s profile`}
        onPress={() => onOpen(userId, displayName, avatarRef.current)}
        style={({ pressed }) => [styles.rowText, pressed && styles.rowPressed]}
      >
        <Text variant="label" numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        {meta ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
      {trailing ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerText: { gap: 2 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.inset,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  body: {
    paddingHorizontal: layout.inset,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.lg,
  },
  center: { alignItems: "center", justifyContent: "center", paddingVertical: tokens.space.xl },
  inviteBlock: {
    gap: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    padding: tokens.space.sm,
  },
  inviteUrl: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 36,
    paddingHorizontal: tokens.space.sm,
    backgroundColor: tokens.bg.surface,
  },
  section: { gap: 0 },
  sectionLabel: { letterSpacing: 1, paddingBottom: tokens.space.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 56,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  rowHighlight: { borderBottomColor: tokens.neon.yellow },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0, gap: 1, paddingVertical: tokens.space.xs },
  name: { color: tokens.text.primary },
  answerPair: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  quietKey: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  addKey: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
});
