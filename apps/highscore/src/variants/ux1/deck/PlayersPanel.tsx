// PLAYERS — the friends surface, as a panel rather than a route. Two levels:
// the roster, and one player's profile. Drilling in slides the profile over
// the roster with the same two-frame step the panel keys use, so nothing in
// the app ever pushes a stack screen.

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
import { confirm, haptics } from "@workshop/ui";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { localDateKey } from "../games/lib/gameDate";
import { shareOrCopyLink } from "../games/lib/share";
import { useGamesRuntime } from "../games/runtime";
import { Avatar, Button, GutterRow, Text, tokens, useToast } from "../theme";
import { PlayerProfile } from "./PlayerProfile";

/** What a friend has done today, across every game you both hold. */
function todayLine(stat: { played: number; leads: number } | undefined): string {
  if (!stat || stat.played === 0) return "Nothing today";
  if (stat.leads > 0) {
    const lead = stat.leads === 1 ? "1 lead" : `${stat.leads} leads`;
    return `${lead} · ${stat.played} played today`;
  }
  return stat.played === 1 ? "1 played today" : `${stat.played} played today`;
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

interface PlayersPanelProps {
  playerId: string | null;
  playerVia: string | null;
  onOpenPlayer: (userId: string, via?: string | null) => void;
  onClosePlayer: () => void;
  onOpenGame: (gameId: string) => void;
}

export function PlayersPanel({
  playerId,
  playerVia,
  onOpenPlayer,
  onClosePlayer,
  onOpenGame,
}: PlayersPanelProps) {
  if (playerId) {
    return (
      <PlayerProfile
        userId={playerId}
        via={playerVia}
        onBack={onClosePlayer}
        onOpenGame={onOpenGame}
      />
    );
  }
  return <Roster onOpenPlayer={onOpenPlayer} />;
}

function Roster({ onOpenPlayer }: { onOpenPlayer: (userId: string) => void }) {
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
  // Today's board for every game is already in cache from the deck, so the
  // roster can say what a friend actually did today instead of the date the
  // edge was created — which nobody has ever needed to know.
  const today = queryClient.getQueryData<GamesResponse>(queryKeys.games.mine(localDateKey()));
  const todayByUser = new Map<string, { played: number; leads: number }>();
  for (const game of today?.games ?? []) {
    for (const entry of game.standings.entries) {
      if (!entry.scoreRaw) continue;
      const stat = todayByUser.get(entry.userId) ?? { played: 0, leads: 0 };
      stat.played += 1;
      if (entry.rank === 1) stat.leads += 1;
      todayByUser.set(entry.userId, stat);
    }
  }

  // Whoever is actually playing today floats to the top; the list is a
  // standings board of people, not an address book. Everyone who hasn't
  // touched a game collapses into one quiet block rather than eight
  // identical "Nothing today" rows.
  const allFriends = [...(friendsQuery.data?.friends ?? [])].sort((a, b) => {
    const sa = todayByUser.get(a.userId);
    const sb = todayByUser.get(b.userId);
    return (
      (sb?.leads ?? 0) - (sa?.leads ?? 0) ||
      (sb?.played ?? 0) - (sa?.played ?? 0) ||
      (a.displayName ?? "").localeCompare(b.displayName ?? "")
    );
  });
  const friends = allFriends.filter((f) => (todayByUser.get(f.userId)?.played ?? 0) > 0);
  const quiet = allFriends.filter((f) => (todayByUser.get(f.userId)?.played ?? 0) === 0);
  const inbound = requestsQuery.data?.inbound ?? [];
  const outboundIds = new Set((requestsQuery.data?.outbound ?? []).map((r) => r.userId));
  const inboundIds = new Set(inbound.map((r) => r.userId));
  // Friends-of-friends are a nicety, not the point of the screen — a long
  // tail of them would outweigh the people you actually play with.
  const MAX_MUTUALS = 5;
  const mutuals = (mutualsQuery.data?.mutuals ?? [])
    .filter((m) => !inboundIds.has(m.userId))
    .slice(0, MAX_MUTUALS);

  const shareInvite = async (url: string, replaced: boolean) => {
    setInviteUrl(url);
    const result = await shareOrCopyLink(url);
    if (result === "copied") {
      showToast({
        message: replaced ? "New link copied — the old one is dead" : "Invite link copied",
        tone: "success",
      });
    } else if (result === "failed") {
      showToast({ message: "Couldn't copy — copy the link below manually.", tone: "danger" });
    }
  };

  const inviteMutation = useMutation({
    mutationFn: () => createFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      await shareInvite(data.url, false);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't create an invite link."), tone: "danger" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetFriendInvite(token),
    onSuccess: async (data) => {
      haptics.medium();
      await shareInvite(data.url, true);
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

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
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
          message: `You're now friends with ${data.friend?.displayName?.trim() || "them"}!`,
          tone: "success",
        });
        await invalidate();
      } else {
        await queryClient.invalidateQueries({ queryKey: queryKeys.friends.requests });
      }
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't send that request."), tone: "danger" });
    },
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
      await invalidate();
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.friends.all });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't decline that request."), tone: "danger" });
    },
    onSettled: (_d, _e, userId) => setAnsweringIds((ids) => ids.filter((id) => id !== userId)),
  });

  const onCopy = async () => {
    if (!inviteUrl) return;
    const ok = await shareOrCopyLink(inviteUrl);
    if (ok === "copied") showToast({ message: "Invite link copied", tone: "success" });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      testID="friends-screen"
    >
      {inbound.length > 0 ? (
        <Section
          marker={
            <Text variant="heading" tone="spotlight" style={styles.markerText}>
              {String(inbound.length)}
            </Text>
          }
          testID="friend-requests-section"
        >
          <Text variant="caption" tone="spotlight" style={styles.sectionLabel}>
            Waiting on you
          </Text>
          {inbound.map((request) => {
            const answering = answeringIds.includes(request.userId);
            const name = request.displayName?.trim() || "Someone";
            return (
              <PersonRow
                key={request.userId}
                userId={request.userId}
                name={name}
                sub="Wants to be friends"
                onPress={() => onOpenPlayer(request.userId)}
                testID={`friend-request-row-${request.userId}`}
                trailing={
                  answering ? (
                    <ActivityIndicator size="small" color={tokens.neon.pink} />
                  ) : (
                    <View style={styles.answerRow}>
                      <TextAction
                        label="Accept"
                        tone="pink"
                        accessibilityLabel={`Accept ${name}`}
                        onPress={() => acceptRequestMutation.mutate(request.userId)}
                        testID={`friend-request-accept-${request.userId}`}
                      />
                      <TextAction
                        label="Decline"
                        tone="muted"
                        accessibilityLabel={`Decline ${name}`}
                        onPress={() => denyRequestMutation.mutate(request.userId)}
                        testID={`friend-request-deny-${request.userId}`}
                      />
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
        <Section marker={null}>
          <Text tone="danger">{errorMessage(friendsQuery.error, "Couldn't load friends.")}</Text>
          <Button label="Retry" variant="secondary" onPress={() => friendsQuery.refetch()} />
        </Section>
      ) : friends.length > 0 ? (
        <Section
          marker={
            <Text variant="heading" tone="secondary" style={styles.markerText}>
              {String(friends.length)}
            </Text>
          }
        >
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            On the board today
          </Text>
          {friends.map((friend, i) => (
            <PersonRow
              key={friend.userId}
              userId={friend.userId}
              name={friend.displayName?.trim() || "Someone"}
              sub={todayLine(todayByUser.get(friend.userId))}
              leading={i === 0 && (todayByUser.get(friend.userId)?.leads ?? 0) > 0}
              onPress={() => onOpenPlayer(friend.userId)}
              testID={`friend-row-${friend.userId}`}
            />
          ))}
        </Section>
      ) : null}

      {quiet.length > 0 ? (
        <Section
          marker={
            <Text variant="heading" tone="muted" style={styles.markerText}>
              {String(quiet.length)}
            </Text>
          }
          testID="friend-quiet-section"
        >
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            Quiet today
          </Text>
          <View style={styles.quietGrid}>
            {quiet.map((friend) => (
              <Pressable
                key={friend.userId}
                accessibilityRole="button"
                accessibilityLabel={`View ${friend.displayName?.trim() || "friend"}'s profile`}
                onPress={() => onOpenPlayer(friend.userId)}
                testID={`friend-row-${friend.userId}`}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  styles.quietChip,
                  (pressed || hovered) && styles.personHover,
                ]}
              >
                <Avatar
                  name={friend.displayName}
                  imageUrl={userAvatarImageUrl(friend.userId)}
                  size="sm"
                />
                <Text variant="caption" tone="muted" numberOfLines={1} style={styles.quietName}>
                  {friend.displayName?.trim() || "Someone"}
                </Text>
              </Pressable>
            ))}
          </View>
        </Section>
      ) : null}

      {mutuals.length > 0 ? (
        <Section
          marker={
            <Text variant="heading" tone="secondary" style={styles.markerText}>
              {String(mutuals.length)}
            </Text>
          }
          testID="friend-mutuals-section"
        >
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            People you may know
          </Text>
          {mutuals.map((mutual) => {
            const requested = outboundIds.has(mutual.userId);
            const requesting = requestingIds.includes(mutual.userId);
            const name = mutual.displayName?.trim() || "Someone";
            return (
              <PersonRow
                key={mutual.userId}
                userId={mutual.userId}
                name={name}
                sub={mutualLine(mutual)}
                onPress={() => onOpenPlayer(mutual.userId)}
                testID={`friend-mutual-row-${mutual.userId}`}
                trailing={
                  requested ? (
                    <Text
                      variant="caption"
                      tone="muted"
                      testID={`friend-requested-${mutual.userId}`}
                    >
                      Asked
                    </Text>
                  ) : requesting ? (
                    <ActivityIndicator size="small" color={tokens.neon.pink} />
                  ) : (
                    <TextAction
                      label="Add"
                      tone="pink"
                      accessibilityLabel={`Send ${name} a friend request`}
                      onPress={() => sendRequestMutation.mutate(mutual.userId)}
                      testID={`friend-mutual-add-${mutual.userId}`}
                    />
                  )
                }
              />
            );
          })}
        </Section>
      ) : null}

      <Section marker={null}>
        <Text variant="caption" tone="muted">
          {Platform.OS === "web" ? "Send a link to anyone." : "Share a link with anyone."}
        </Text>
        <Button
          label={Platform.OS === "web" ? "Create invite link" : "Invite a friend"}
          onPress={() => inviteMutation.mutate()}
          loading={inviteMutation.isPending}
          testID="friends-invite-button"
        />
        {inviteUrl ? (
          <>
            <View style={styles.inviteRow}>
              <View style={styles.inviteField}>
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
                onPress={onCopy}
                testID="friends-invite-copy"
              />
            </View>
            <TextAction
              label={resetMutation.isPending ? "Resetting…" : "Reset link"}
              tone="muted"
              accessibilityLabel="Reset invite link"
              onPress={onReset}
              testID="friends-invite-reset"
            />
          </>
        ) : null}
      </Section>
    </ScrollView>
  );
}

function Section({
  marker,
  children,
  testID,
}: {
  marker: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <GutterRow rule marker={marker} style={styles.section} testID={testID}>
      <View style={styles.sectionBody}>{children}</View>
    </GutterRow>
  );
}

interface PersonRowProps {
  userId: string;
  name: string;
  sub: string;
  /** Leading at least one game today — the one thing worth spotlighting. */
  leading?: boolean;
  onPress: () => void;
  trailing?: React.ReactNode;
  testID?: string;
}

function PersonRow({ userId, name, sub, leading, onPress, trailing, testID }: PersonRowProps) {
  return (
    <View style={styles.person} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name}'s profile`}
        onPress={onPress}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.personMain,
          (pressed || hovered) && styles.personHover,
        ]}
      >
        <Avatar name={name} imageUrl={userAvatarImageUrl(userId)} size="md" />
        <View style={styles.personText}>
          <Text variant="label" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="caption" tone={leading ? "spotlight" : "muted"} numberOfLines={1}>
            {sub}
          </Text>
        </View>
      </Pressable>
      {trailing}
    </View>
  );
}

function TextAction({
  label,
  tone,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  tone: "pink" | "muted";
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={8}
      testID={testID}
      style={({ pressed }) => [pressed && styles.actionPressed]}
    >
      <Text variant="label" style={tone === "pink" ? styles.actionPink : styles.actionMuted}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: tokens.space.md, paddingBottom: tokens.space.xxl },
  section: { paddingBottom: tokens.space.xl },
  sectionBody: { gap: tokens.space.sm },
  markerText: { fontSize: 14, lineHeight: 20, letterSpacing: 1 },
  sectionLabel: { textTransform: "uppercase", letterSpacing: 0.8 },
  quietGrid: { flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm },
  quietChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingRight: tokens.space.sm,
    minHeight: 32,
  },
  quietName: { maxWidth: 96 },
  center: { paddingVertical: tokens.space.xxl, alignItems: "center" },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 44,
  },
  personMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 44,
  },
  personHover: { backgroundColor: tokens.bg.surface },
  personText: { flex: 1, minWidth: 0 },
  answerRow: { flexDirection: "row", gap: tokens.space.md },
  actionPink: { color: tokens.neon.pinkTint, fontSize: 12 },
  actionMuted: { color: tokens.text.secondary, fontSize: 12 },
  actionPressed: { opacity: 0.6 },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  inviteField: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
});
