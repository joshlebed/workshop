// YOU — identity, today's numbers, and the settings that don't belong anywhere
// else. Replaces the old profile sheet: the dock's YOU key opens this screen,
// and a long press on the same key throws up the three shortcuts (edit, players,
// sign out) without leaving home.
//
// Deliberately short. Edit profile and Players are dock keys here, so they are
// not repeated as rows — the list is only the things with nowhere else to live.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFriendRequests, fetchFriends } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { AdminImpersonation } from "../components/AdminImpersonation";
import { fetchMyGames } from "../games/api/games";
import { localDateKey } from "../games/lib/gameDate";
import { goBack } from "../games/lib/navigation";
import { useAuth } from "../hooks/useAuth";
import { PRIVACY_ROUTE, SUPPORT_ROUTE } from "../lib/publicRoutes";
import { DOCK_HEIGHT, type DockKey, useDock } from "../nav/dock";
import { Avatar } from "../theme/Avatar";
import { Screen } from "../theme/layout";
import { Text } from "../theme/Text";
import { tokens } from "../theme/tokens";

const RAIL = 42;

export default function You() {
  const { token, user, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const todayKey = localDateKey();

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

  // The dock's YOU key wears the pending-request notch, so landing here has to
  // say what the notch was about instead of dead-ending.
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
  });
  const pendingRequests = requestsQuery.data?.inbound.length ?? 0;

  const games = gamesQuery.data?.games ?? [];
  const postedToday = games.filter((g) => g.standings.viewerHasPlayed).length;

  const onSendFeedback = () => {
    const subject = encodeURIComponent("HighScore feedback");
    const version = Constants.expoConfig?.version ?? "0.0.0";
    const body = encodeURIComponent(
      `\n\nFeedback context\nHighScore v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
    );
    Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(() => {});
  };

  // Impersonation swaps the whole session — drop every cached query so no other
  // user's data leaks across accounts.
  const onSessionChanged = useCallback(() => {
    queryClient.clear();
    router.replace("/");
  }, [queryClient, router]);

  const back = useCallback(() => goBack("/"), []);
  const dockKeys = useMemo<DockKey[]>(
    () => [
      {
        id: "relate",
        label: "Edit",
        glyph: "pencil",
        tone: "primary",
        weight: 1.5,
        onPress: () => router.push("/profile" as Href),
        testID: "open-edit-profile",
        accessibilityLabel: "Edit profile",
      },
      {
        id: "back",
        label: "Back",
        glyph: "arrow-left",
        weight: 0.7,
        onPress: back,
        testID: "you-back",
      },
    ],
    [router, back],
  );
  useDock(dockKeys);

  return (
    <Screen testID="you-screen">
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.identity}>
          <View style={styles.rail}>
            <Avatar
              name={user?.displayName ?? user?.email ?? null}
              imageUrl={user?.avatarUrl ?? null}
              size="md"
            />
          </View>
          <View style={styles.identityText}>
            <Text variant="title" numberOfLines={1} style={styles.name}>
              {user?.displayName ?? "HighScore"}
            </Text>
            {user?.email ? (
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Three numbers, no labels repeated as sentences elsewhere. */}
        <View style={styles.stats}>
          <Stat value={games.length} label="Games" />
          <Stat value={friendsQuery.data?.friends.length ?? 0} label="Players" />
          <Stat
            value={postedToday}
            label="Posted"
            tone={games.length > 0 && postedToday === games.length ? "success" : "secondary"}
          />
        </View>

        <View>
          {pendingRequests > 0 ? (
            <Row
              label={
                pendingRequests === 1 ? "1 request waiting" : `${pendingRequests} requests waiting`
              }
              tone="link"
              onPress={() => router.push("/friends" as Href)}
              testID="you-pending-requests"
            />
          ) : null}
          <Row label="Send feedback" onPress={onSendFeedback} testID="send-feedback" />
          {/* Both routes are public pages (see src/lib/publicRoutes.ts), so the
              in-app push lands on the same content Apple sees at the published
              highscore.live URLs — on native and web alike. */}
          <Row label="Support" onPress={() => router.push(SUPPORT_ROUTE)} testID="open-support" />
          <Row
            label="Privacy policy"
            onPress={() => router.push(PRIVACY_ROUTE)}
            testID="open-privacy"
          />
          <Row label="Sign out" tone="danger" onPress={() => void signOut()} testID="sign-out" />
        </View>

        <View style={styles.admin}>
          <AdminImpersonation onSessionChanged={onSessionChanged} />
        </View>

        <Text variant="caption" tone="secondary" style={styles.version}>
          {`HighScore ${Constants.expoConfig?.version ?? "0.0.0"}`}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({
  value,
  label,
  tone = "secondary",
}: {
  value: number;
  label: string;
  tone?: "secondary" | "success";
}) {
  return (
    <View style={styles.stat}>
      <Text
        variant="score"
        tone={tone === "success" ? "success" : "primary"}
        style={styles.statValue}
      >
        {String(value)}
      </Text>
      <Text variant="heading" tone="secondary" style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

/** No leading glyph: these rows are a list of words, and a decorative icon
 *  column beside each one would say nothing the word doesn't. */
function Row({
  label,
  onPress,
  tone,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: "danger" | "link";
  testID: string;
}) {
  const color =
    tone === "danger"
      ? tokens.status.danger
      : tone === "link"
        ? tokens.neon.pink
        : tokens.text.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && styles.rowActive,
      ]}
    >
      <Text variant="label" style={[styles.rowLabel, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: DOCK_HEIGHT + tokens.space.xl },
  identity: {
    flexDirection: "row",
    paddingTop: tokens.space.lg,
    paddingRight: tokens.space.md,
    paddingBottom: tokens.space.lg,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  rail: {
    width: RAIL,
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  identityText: { flex: 1, minWidth: 0, paddingLeft: tokens.space.md, gap: tokens.space.sm },
  name: { fontSize: 14, color: tokens.text.primary },
  stats: {
    flexDirection: "row",
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.lg,
  },
  statValue: { fontSize: 20, lineHeight: 26 },
  statLabel: { fontSize: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: RAIL + tokens.space.md,
    paddingVertical: tokens.space.lg,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  rowActive: { backgroundColor: tokens.bg.surface },
  rowLabel: { fontSize: 15 },
  admin: { padding: tokens.space.md, gap: tokens.space.sm },
  version: { paddingLeft: RAIL + tokens.space.md, paddingTop: tokens.space.lg },
});
