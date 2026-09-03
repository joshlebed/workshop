// Friends, as a sheet over the timeline.
//
// Three sections in the order they matter: people waiting on you, the people
// you compare scores with, and people you probably know. The invite link is one
// row at the top rather than a card — it's a single action, and a bordered box
// around a single action is packaging, not design. Tapping anyone pushes their
// profile onto this same sheet.

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
import type { GamesResponse } from "@workshop/shared/games";
import { confirm, formatRelative, haptics } from "@workshop/ui";
import { type Href, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import { fetchMyGames } from "../games/api/games";
import { localDateKey } from "../games/lib/gameDate";
import { shareOrCopyLink } from "../games/lib/share";
import { useGamesRuntime } from "../games/runtime";
import { SheetFrame } from "../nav/SheetFrame";
import type { SheetNav } from "../nav/SheetHost";
import { Avatar, PixelIcon, Text, tokens, useToast } from "../theme";

/**
 * Per-friend one-liner for today: how many of your shared games they've posted
 * and how many of those they lead. Undefined when they've posted nothing.
 */
function summarizeToday(data: GamesResponse | undefined): Map<string, string> {
  const out = new Map<string, { posted: number; wins: number }>();
  for (const game of data?.games ?? []) {
    for (const entry of game.standings.entries) {
      if (!entry.scoreRaw) continue;
      const current = out.get(entry.userId) ?? { posted: 0, wins: 0 };
      current.posted += 1;
      if (entry.rank === 1) current.wins += 1;
      out.set(entry.userId, current);
    }
  }
  return new Map(
    [...out].map(([userId, { posted, wins }]) => [
      userId,
      wins > 0 ? `${posted} posted today · ${wins} leading` : `${posted} posted today`,
    ]),
  );
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

export function FriendsSheet({ nav }: { nav: SheetNav }) {
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

  // "Friends since 6/11/2026" tells you nothing you'd act on. Today's board
  // does — and it's already in cache from the timeline behind this sheet.
  const todayKey = localDateKey();
  const todayQuery = useQuery({
    queryKey: queryKeys.games.mine(todayKey),
    queryFn: () => fetchMyGames(todayKey, token),
    enabled,
  });
  const todayByUser = useMemo(() => summarizeToday(todayQuery.data), [todayQuery.data]);

  // Two groups, not one alphabetical column: who is on the board today, and
  // everyone else. The heading carries "nothing today" once instead of every
  // quiet row repeating it.
  const { active, quiet } = useMemo(() => {
    const all = [...(friendsQuery.data?.friends ?? [])].sort((a, b) =>
      (a.displayName ?? "").localeCompare(b.displayName ?? ""),
    );
    return {
      active: all.filter((f) => todayByUser.has(f.userId)),
      quiet: all.filter((f) => !todayByUser.has(f.userId)),
    };
  }, [friendsQuery.data, todayByUser]);
  const friends = [...active, ...quiet];
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

  const acceptRequestMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return acceptFriendRequestFrom(userId, token);
    },
    onSuccess: async (data) => {
      haptics.medium();
      showToast({
        message: `You're now friends with ${data.friend.displayName?.trim() || "them"}`,
        tone: "success",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests }),
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't accept that request."), tone: "danger" });
    },
    onSettled: (_d, _e, userId) => setAnsweringIds((ids) => ids.filter((id) => id !== userId)),
  });

  const denyRequestMutation = useMutation({
    mutationFn: (userId: string) => {
      setAnsweringIds((ids) => [...ids, userId]);
      return removeFriendRequest(userId, token);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" });
    },
    onSettled: (_d, _e, userId) => setAnsweringIds((ids) => ids.filter((id) => id !== userId)),
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
          message: `You're now friends with ${data.friend?.displayName?.trim() || "them"}`,
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
    onSettled: (_d, _e, userId) => setRequestingIds((ids) => ids.filter((id) => id !== userId)),
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

  const openProfile = (userId: string) => router.push(routes.friendProfile(userId) as Href);

  return (
    <SheetFrame
      title="Friends"
      nav={nav}
      testID="friends-screen"
      meta={
        // Twelve friends in, "invite" is not the loudest thing you came for.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={Platform.OS === "web" ? "Create invite link" : "Invite a friend"}
          onPress={() => inviteMutation.mutate()}
          disabled={inviteMutation.isPending}
          testID="friends-invite-button"
          hitSlop={8}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.inviteAction,
            (pressed || hovered) && styles.pressedFill,
          ]}
        >
          {inviteMutation.isPending ? (
            <ActivityIndicator size="small" color={tokens.neon.pink} />
          ) : (
            <PixelIcon name="share" size={16} color={tokens.neon.pink} />
          )}
          <Text variant="eyebrow" tone="link">
            {Platform.OS === "web" ? "Create invite link" : "Invite a friend"}
          </Text>
        </Pressable>
      }
    >
      {inviteUrl ? (
        <View style={styles.inviteBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy invite link"
            onPress={async () => {
              const result = await shareOrCopyLink(inviteUrl);
              if (result === "copied") {
                showToast({ message: "Invite link copied", tone: "success" });
              }
            }}
            testID="friends-invite-copy"
            style={({ pressed }) => [styles.inviteRow, pressed && styles.pressedFill]}
          >
            <Text
              variant="mono"
              tone="secondary"
              numberOfLines={1}
              style={styles.inviteUrl}
              testID="friends-invite-url"
            >
              {inviteUrl}
            </Text>
            <PixelIcon name="copy" size={16} color={tokens.neon.pink} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset invite link"
            onPress={onReset}
            disabled={resetMutation.isPending}
            testID="friends-invite-reset"
            hitSlop={8}
            style={styles.resetRow}
          >
            <Text variant="eyebrow" tone="danger">
              {resetMutation.isPending ? "Resetting…" : "Reset link"}
            </Text>
            <Text variant="caption" tone="muted">
              Stops the current link working.
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
            return (
              <PersonRow
                key={request.userId}
                userId={request.userId}
                name={request.displayName}
                meta={`Asked ${formatRelative(request.requestedAt)}`}
                onPress={() => openProfile(request.userId)}
                testID={`friend-request-row-${request.userId}`}
                trailing={
                  answering ? (
                    <ActivityIndicator size="small" color={tokens.neon.pink} />
                  ) : (
                    <View style={styles.answerPair}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Accept ${request.displayName?.trim() || "request"}`}
                        onPress={() => acceptRequestMutation.mutate(request.userId)}
                        testID={`friend-request-accept-${request.userId}`}
                        hitSlop={6}
                        style={({ pressed }) => [styles.accept, pressed && styles.pressedFill]}
                      >
                        <Text variant="eyebrow" tone="link">
                          Accept
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Decline ${request.displayName?.trim() || "request"}`}
                        onPress={() => denyRequestMutation.mutate(request.userId)}
                        testID={`friend-request-deny-${request.userId}`}
                        hitSlop={6}
                        style={styles.quietAction}
                      >
                        <Text variant="eyebrow" tone="secondary">
                          Decline
                        </Text>
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
        <ActivityIndicator color={tokens.neon.pink} style={styles.loading} />
      ) : friendsQuery.isError ? (
        <Text tone="danger">{errorMessage(friendsQuery.error)}</Text>
      ) : friends.length === 0 ? (
        <Text tone="secondary">
          No friends yet. Send the invite link above to start comparing daily scores.
        </Text>
      ) : (
        <>
          {active.length > 0 ? (
            <Section label={`On the board today · ${active.length}`}>
              {active.map((friend) => (
                <PersonRow
                  key={friend.userId}
                  userId={friend.userId}
                  name={friend.displayName}
                  meta={todayByUser.get(friend.userId) ?? ""}
                  onPress={() => openProfile(friend.userId)}
                  testID={`friend-row-${friend.userId}`}
                />
              ))}
            </Section>
          ) : null}
          {quiet.length > 0 ? (
            <Section label={`Nothing today · ${quiet.length}`}>
              {quiet.map((friend) => (
                <PersonRow
                  key={friend.userId}
                  userId={friend.userId}
                  name={friend.displayName}
                  onPress={() => openProfile(friend.userId)}
                  testID={`friend-row-${friend.userId}`}
                />
              ))}
            </Section>
          ) : null}
        </>
      )}

      {mutuals.length > 0 ? (
        <Section label="People you may know" testID="friend-mutuals-section">
          {mutuals.map((mutual) => {
            const requested = outboundIds.has(mutual.userId);
            const requesting = requestingIds.includes(mutual.userId);
            return (
              <PersonRow
                key={mutual.userId}
                userId={mutual.userId}
                name={mutual.displayName}
                meta={mutualLine(mutual)}
                onPress={() => openProfile(mutual.userId)}
                testID={`friend-mutual-row-${mutual.userId}`}
                trailing={
                  requested ? (
                    <Text
                      variant="eyebrow"
                      tone="muted"
                      testID={`friend-requested-${mutual.userId}`}
                    >
                      Requested
                    </Text>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Send ${mutual.displayName?.trim() || "them"} a friend request`}
                      onPress={() => sendRequestMutation.mutate(mutual.userId)}
                      disabled={requesting}
                      testID={`friend-mutual-add-${mutual.userId}`}
                      hitSlop={6}
                      style={({ pressed }) => [styles.accept, pressed && styles.pressedFill]}
                    >
                      {requesting ? (
                        <ActivityIndicator size="small" color={tokens.neon.pink} />
                      ) : (
                        <Text variant="eyebrow" tone="link">
                          Add
                        </Text>
                      )}
                    </Pressable>
                  )
                }
              />
            );
          })}
        </Section>
      ) : null}
    </SheetFrame>
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
    <View style={styles.section} testID={testID}>
      <Text variant="eyebrow" tone="secondary" style={styles.sectionLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

export function PersonRow({
  userId,
  name,
  meta,
  onPress,
  trailing,
  testID,
}: {
  userId: string;
  name: string | null;
  /** Omit entirely rather than printing the same filler on every row. */
  meta?: string;
  onPress: () => void;
  trailing?: ReactNode;
  testID?: string;
}) {
  // The row is a View, not a Pressable: `trailing` holds real buttons
  // (Accept / Decline / Add) and react-native-web renders every Pressable as a
  // <button>, so wrapping them in another one is invalid DOM.
  return (
    <View style={styles.person} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name?.trim() || "their"} profile`}
        onPress={onPress}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.personTap,
          (pressed || hovered) && styles.pressedFill,
        ]}
      >
        <Avatar name={name} imageUrl={userAvatarImageUrl(userId)} size="md" />
        <View style={styles.personText}>
          <Text variant="label" numberOfLines={1} style={styles.personName}>
            {name?.trim() || "Someone"}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </Pressable>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  inviteAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    alignSelf: "flex-start",
    paddingVertical: tokens.space.xs,
  },
  pressedFill: { backgroundColor: tokens.bg.raised },
  inviteBlock: { gap: tokens.space.sm },
  inviteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  inviteUrl: { flex: 1, minWidth: 0 },
  resetRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  section: { gap: tokens.space.xs, marginTop: tokens.space.sm },
  sectionLabel: { marginBottom: tokens.space.xs },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 48,
    marginHorizontal: -tokens.space.xs,
  },
  personTap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.xs,
    paddingVertical: tokens.space.xs,
  },
  personText: { flex: 1, minWidth: 0, gap: 1 },
  personName: { color: tokens.text.primary },
  answerPair: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  accept: {
    paddingHorizontal: tokens.space.md,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  quietAction: { paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs },
  loading: { alignSelf: "flex-start" },
});
