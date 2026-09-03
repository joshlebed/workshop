// YOU — a screen, not a menu sheet. The old profile lived behind an avatar in
// the header that opened a stack of eight identical buttons; a sheet is the
// wrong container for the place you keep your identity, your day and the
// destructive settings.
//
// Your own day rides at the top, using the same cells the matrix uses, so the
// screen opens with something true about you rather than a list of admin.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { fetchFriendRequests, fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { fetchImpersonationTargets } from "../api/users";
import { KeyPanel } from "../components/KeyPanel";
import { Wordmark } from "../components/Wordmark";
import { fetchMyGames } from "../games/api/games";
import { GameCover } from "../games/components/GameCover";
import { CELL_GAP, ScoreCell } from "../games/components/ScoreCell";
import { localDateKey } from "../games/lib/gameDate";
import { buildPlayerRows } from "../games/lib/matrix";
import { useAuth } from "../hooks/useAuth";
import { PRIVACY_ROUTE, SUPPORT_ROUTE } from "../lib/publicRoutes";
import { Avatar, Button, layout, Screen, Text, tokens, useToast } from "../theme";

export default function You() {
  const { token, user, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const livePoll = useLivePollingInterval();
  const todayKey = localDateKey();

  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pending = requestsQuery.data?.inbound.length ?? 0;

  const gamesQuery = useQuery({
    queryKey: queryKeys.games.mine(todayKey),
    queryFn: () => fetchMyGames(todayKey, token),
    enabled: !!token,
  });
  const friendsQuery = useQuery({
    queryKey: queryKeys.friends.all,
    queryFn: () => fetchFriends(token),
    enabled: !!token,
  });

  const games = useMemo(() => gamesQuery.data?.games ?? [], [gamesQuery.data]);
  const myRow = useMemo(
    () =>
      buildPlayerRows({
        games,
        friends: friendsQuery.data?.friends ?? [],
        selfId: user?.id ?? null,
        selfName: user?.displayName ?? null,
      }).find((row) => row.isSelf) ?? null,
    [games, friendsQuery.data, user?.id, user?.displayName],
  );

  const bestStreak = useMemo(
    () => games.reduce((best, mg) => Math.max(best, mg.standings.viewerStreak), 0),
    [games],
  );

  const onSendFeedback = () => {
    const subject = encodeURIComponent("HighScore feedback");
    const version = Constants.expoConfig?.version ?? "0.0.0";
    const body = encodeURIComponent(
      `\n\nFeedback context\nHighScore v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
    );
    Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(() => {});
  };

  // Impersonation swaps the whole session — drop every cached query so no
  // other user's data leaks across accounts.
  const onAuthSessionChanged = useCallback(() => queryClient.clear(), [queryClient]);

  return (
    <Screen testID="you-screen">
      <View style={styles.header}>
        <Wordmark />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.identity}>
          <Avatar
            name={user?.displayName ?? user?.email ?? null}
            imageUrl={user?.avatarUrl ?? userAvatarImageUrl(user?.id ?? "")}
            size="lg"
          />
          <View style={styles.identityText}>
            <Text variant="title" numberOfLines={1}>
              {user?.displayName ?? "Player"}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {user?.email ?? ""}
            </Text>
          </View>
        </View>

        {myRow ? (
          <View style={styles.stats} testID="you-stats">
            <Stat label="Played" value={`${myRow.playedCount}/${myRow.cells.length}`} />
            <Stat
              label="Firsts"
              value={String(myRow.firsts)}
              tone={myRow.firsts > 0 ? "spotlight" : "primary"}
            />
            <Stat
              label="Streak"
              value={String(bestStreak)}
              tone={bestStreak > 0 ? "success" : "primary"}
            />
          </View>
        ) : null}

        {myRow && myRow.cells.length > 0 ? (
          <View style={styles.dayStrip} testID="you-day-strip">
            <Text variant="eyebrow" tone="secondary" style={styles.sectionLabel}>
              Today, game by game
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.strip}>
                {myRow.cells.map((cell) => (
                  <View key={cell.gameId} style={styles.stripColumn}>
                    <GameCover
                      iconUrl={games.find((g) => g.gameId === cell.gameId)?.game.iconUrl ?? null}
                      size={22}
                      dim={!cell.played}
                    />
                    <ScoreCell
                      played={cell.played}
                      glyph={cell.glyph}
                      outrightFirst={cell.outrightFirst}
                      isSelf
                      accessibilityLabel={`${cell.gameTitle}: ${cell.body ?? "not played"}`}
                      onPress={() => router.push(`/games/${cell.gameId}` as Href)}
                    />
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {/* A cabinet menu: labels only. Six rows of icon-plus-label-plus-
            chevron is eighteen elements saying what six words already say. */}
        <View>
          <MenuKey
            label="Edit profile"
            onPress={() => router.push("/profile")}
            testID="open-edit-profile"
          />
          <MenuKey
            label={pending > 0 ? `Friends · ${pending} waiting` : "Friends"}
            onPress={() => router.navigate("/friends" as Href)}
            testID="you-friends"
          />
          <MenuKey label="Send feedback" onPress={onSendFeedback} testID="send-feedback" />
          {/* Both routes are public pages (src/lib/publicRoutes.ts), so the
              in-app push lands on the same content Apple sees at the published
              highscore.live URLs. */}
          <MenuKey
            label="Privacy"
            onPress={() => router.push(PRIVACY_ROUTE)}
            testID="open-privacy"
          />
          <MenuKey
            label="Support"
            onPress={() => router.push(SUPPORT_ROUTE)}
            testID="open-support"
          />
          <MenuKey label="Sign out" onPress={() => void signOut()} quiet testID="sign-out" />
        </View>

        <AdminImpersonation onSessionChanged={onAuthSessionChanged} />
      </ScrollView>

      <KeyPanel active="you" pending={pending} />
    </Screen>
  );
}

function Stat({
  label,
  value,
  tone = "primary",
}: {
  label: string;
  value: string;
  tone?: "primary" | "spotlight" | "success";
}) {
  return (
    <View style={styles.stat}>
      <Text variant="score" tone={tone} style={styles.statValue}>
        {value}
      </Text>
      <Text variant="caption" tone="secondary" style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

function MenuKey({
  label,
  onPress,
  quiet = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  /** Sign out sits apart and reads quieter than the rest. */
  quiet?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.menuKey,
        quiet && styles.menuKeyQuiet,
        pressed && styles.menuKeyPressed,
      ]}
    >
      <Text variant="body" tone={quiet ? "secondary" : "primary"}>
        {label}
      </Text>
    </Pressable>
  );
}

// Hidden unless the server says the signed-in user is an admin (`user.isAdmin`);
// the backend enforces the same gate on both the target list and the
// impersonate endpoint, so this check is presentation-only.
function AdminImpersonation({ onSessionChanged }: { onSessionChanged: () => void }) {
  const { user, token, impersonation, impersonateUser, stopImpersonating } = useAuth();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const targetsQuery = useQuery({
    queryKey: queryKeys.users.impersonationTargets,
    queryFn: () => fetchImpersonationTargets(token),
    enabled: Boolean(user?.isAdmin && open && token && !impersonation),
    staleTime: 60_000,
  });
  const targets = targetsQuery.data?.users ?? [];

  const labelFor = (u: { displayName: string | null; email: string | null }) =>
    u.displayName?.trim() || u.email || "user";

  if (impersonation) {
    const adminLabel =
      impersonation.adminDisplayName?.trim() || impersonation.adminEmail || "Admin";
    return (
      <View style={styles.admin} testID="admin-impersonation-status">
        <Text variant="caption" tone="secondary">
          Impersonating. Started by {adminLabel}.
        </Text>
        <Button
          label="Stop"
          variant="secondary"
          size="sm"
          pixel
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await stopImpersonating();
              showToast({ message: "Back to your account", tone: "success" });
              onSessionChanged();
            } catch (e) {
              showToast({
                message: errorMessage(e, "Couldn't stop impersonating."),
                tone: "danger",
              });
            } finally {
              setBusy(false);
            }
          }}
          testID="stop-impersonating"
        />
      </View>
    );
  }

  if (!user?.isAdmin) return null;

  if (!open) {
    return (
      <View style={styles.admin}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Admin: impersonate a user"
          onPress={() => setOpen(true)}
          hitSlop={8}
          testID="open-admin-impersonation"
        >
          <Text variant="caption" tone="secondary">
            Admin · impersonate
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.admin} testID="admin-impersonation-form">
      {targetsQuery.isLoading ? (
        <ActivityIndicator color={tokens.neon.pink} />
      ) : targetsQuery.isError ? (
        <View style={styles.adminError}>
          <Text variant="caption" tone="danger">
            Couldn't load users.
          </Text>
          <Button
            label="Retry"
            variant="secondary"
            size="sm"
            pixel
            onPress={() => targetsQuery.refetch()}
            loading={targetsQuery.isFetching}
          />
        </View>
      ) : (
        targets.map((targetUser) => (
          <Pressable
            key={targetUser.id}
            accessibilityRole="button"
            accessibilityLabel={`Impersonate ${targetUser.email}`}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              try {
                const nextUser = await impersonateUser(targetUser.email);
                showToast({ message: `Signed in as ${labelFor(nextUser)}`, tone: "success" });
                setOpen(false);
                onSessionChanged();
              } catch (e) {
                showToast({
                  message: errorMessage(e, "Couldn't impersonate that user."),
                  tone: "danger",
                });
              } finally {
                setBusy(false);
              }
            }}
            testID={`admin-impersonation-option-${targetUser.email}`}
            style={({ pressed }) => [styles.adminRow, pressed && styles.menuKeyPressed]}
          >
            <Text variant="caption" numberOfLines={1}>
              {targetUser.email}
            </Text>
          </Pressable>
        ))
      )}
      <Button
        label="Cancel"
        variant="ghost"
        size="sm"
        pixel
        onPress={() => setOpen(false)}
        disabled={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: layout.inset,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  body: {
    paddingHorizontal: layout.inset,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.lg,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  stats: { flexDirection: "row", gap: tokens.space.lg },
  stat: { gap: 2 },
  statValue: { letterSpacing: 0 },
  statLabel: { letterSpacing: 1, textTransform: "uppercase", fontSize: 10 },
  dayStrip: { gap: tokens.space.xs },
  sectionLabel: { letterSpacing: 1 },
  strip: { flexDirection: "row", gap: CELL_GAP },
  stripColumn: { alignItems: "center", gap: tokens.space.xs },
  menuKey: {
    justifyContent: "center",
    minHeight: 48,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  menuKeyQuiet: { marginTop: tokens.space.md, borderBottomWidth: 0 },
  menuKeyPressed: { backgroundColor: tokens.bg.surface },
  admin: { gap: tokens.space.sm, alignItems: "flex-start" },
  adminError: { gap: tokens.space.sm, alignItems: "flex-start" },
  adminRow: { minHeight: 36, justifyContent: "center", width: "100%" },
});
