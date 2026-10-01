// YOU — the account surface. This used to be a sheet hanging off an avatar in
// the header; it is a panel now, so the three things the app is made of
// (games, people, you) are all reachable in one tap from anywhere.
//
// Editing the profile still pushes `/profile`: it is a form with a destructive
// zone at the bottom, and a form deserves its own screen.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GamesResponse } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
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
import { localDateKey } from "../games/lib/gameDate";
import { useAuth } from "../hooks/useAuth";
import { PRIVACY_ROUTE, SUPPORT_ROUTE } from "../lib/publicRoutes";
import { Avatar, Button, GutterRow, PixelIcon, Text, tokens, useToast } from "../theme";

export function YouPanel() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  // Your own day, read out of the deck's cache — the panel says how you're
  // doing before it offers you a menu.
  const today = queryClient.getQueryData<GamesResponse>(queryKeys.games.mine(localDateKey()));
  const mine = (today?.games ?? []).filter((g) => g.standings.viewerHasPlayed);
  const leads = mine.filter(
    (g) => g.standings.entries.find((e) => e.userId === user?.id)?.rank === 1,
  ).length;
  const bestStreak = (today?.games ?? []).reduce(
    (best, g) => Math.max(best, g.standings.viewerStreak),
    0,
  );
  const remaining = (today?.games ?? []).length - mine.length;

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
  const onAuthSessionChanged = useCallback(() => {
    queryClient.clear();
  }, [queryClient]);

  return (
    <ScrollView contentContainerStyle={styles.scroll} testID="you-panel">
      <GutterRow
        rule
        marker={
          <Avatar
            name={user?.displayName ?? user?.email ?? null}
            imageUrl={user?.avatarUrl ?? null}
            size="lg"
          />
        }
        style={styles.identity}
      >
        <Text variant="title" numberOfLines={1} style={styles.name}>
          {user?.displayName ?? "HighScore"}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {user?.email ?? ""}
        </Text>
        <View style={styles.today}>
          <Stat value={String(mine.length)} label="played" tone="primary" />
          <Stat value={String(leads)} label="leading" tone={leads > 0 ? "spotlight" : "muted"} />
          <Stat
            value={bestStreak >= STREAK_MIN_DAYS ? String(bestStreak) : "—"}
            label="day run"
            tone={bestStreak >= STREAK_MIN_DAYS ? "success" : "muted"}
          />
        </View>
        {remaining > 0 ? (
          <Text variant="caption" tone="muted">
            {remaining === 1 ? "1 game still open today." : `${remaining} games still open today.`}
          </Text>
        ) : null}
        <View style={styles.identityAction}>
          <Button
            label="Edit profile"
            variant="secondary"
            testID="open-edit-profile"
            onPress={() => router.push("/profile")}
          />
        </View>
      </GutterRow>

      <GutterRow rule marker={null}>
        <MenuRow
          label="Send feedback"
          mark="external"
          testID="send-feedback"
          onPress={onSendFeedback}
        />
        <MenuRow
          label="Support"
          mark="push"
          testID="open-support"
          onPress={() => router.push(SUPPORT_ROUTE)}
        />
        <MenuRow
          label="Privacy policy"
          mark="push"
          testID="open-privacy"
          onPress={() => router.push(PRIVACY_ROUTE)}
        />
        <MenuRow label="Sign out" mark="none" testID="sign-out" onPress={() => void signOut()} />
      </GutterRow>

      <AdminImpersonation onSessionChanged={onAuthSessionChanged} />

      <Text variant="caption" tone="muted" style={styles.version}>
        {`v${Constants.expoConfig?.version ?? "0.0.0"}`}
      </Text>
    </ScrollView>
  );
}

/**
 * A ruled label. No leading icon — the trailing mark is the only thing that
 * needs to differ, because it says where the row goes: in-app, out of the
 * app, or nowhere.
 */
function MenuRow({
  label,
  mark,
  onPress,
  testID,
}: {
  label: string;
  mark: "push" | "external" | "none";
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.menuRow,
        (pressed || hovered) && styles.menuRowHover,
      ]}
    >
      <Text variant="label" style={styles.menuLabel}>
        {label}
      </Text>
      {mark === "push" ? (
        <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
      ) : mark === "external" ? (
        <PixelIcon name="external-link" size={16} color={tokens.text.secondary} />
      ) : null}
    </Pressable>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "primary" | "spotlight" | "success" | "muted";
}) {
  return (
    <View style={styles.stat}>
      <Text variant="score" tone={tone} style={styles.statValue}>
        {value}
      </Text>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

/**
 * Hidden unless the server says the signed-in user is an admin. The backend
 * gates both the target list and the impersonate endpoint the same way, so
 * this check is presentation-only.
 */
function AdminImpersonation({ onSessionChanged }: { onSessionChanged: () => void }) {
  const { user, token, impersonation, impersonateUser, stopImpersonating } = useAuth();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const targetsQuery = useQuery({
    queryKey: queryKeys.users.impersonationTargets,
    queryFn: () => fetchImpersonationTargets(token),
    enabled: Boolean(user?.isAdmin && editing && token && !impersonation),
    staleTime: 60_000,
  });
  const targets = targetsQuery.data?.users ?? [];

  const labelFor = (u: { displayName: string | null; email: string | null }) =>
    u.displayName?.trim() || u.email || "user";

  const onImpersonate = async (email: string) => {
    setBusy(true);
    try {
      const nextUser = await impersonateUser(email);
      showToast({ message: `Signed in as ${labelFor(nextUser)}`, tone: "success" });
      setEditing(false);
      setTarget("");
      onSessionChanged();
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't impersonate that user."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const onStop = async () => {
    setBusy(true);
    try {
      await stopImpersonating();
      showToast({ message: "Back to your account", tone: "success" });
      onSessionChanged();
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't stop impersonating."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  if (impersonation) {
    const adminLabel =
      impersonation.adminDisplayName?.trim() || impersonation.adminEmail || "Admin";
    return (
      <GutterRow
        rule
        marker={<PixelIcon name="user" size={16} color={tokens.status.warning} />}
        style={styles.admin}
        testID="admin-impersonation-status"
      >
        <Text variant="caption" tone="muted">
          Impersonating. Started by {adminLabel}.
        </Text>
        <Button
          label="Stop impersonating"
          variant="secondary"
          loading={busy}
          onPress={onStop}
          testID="stop-impersonating"
        />
      </GutterRow>
    );
  }

  if (!user?.isAdmin) return null;

  return (
    <GutterRow rule marker={null} style={styles.admin}>
      {editing ? (
        <View style={styles.adminList} testID="admin-impersonation-form">
          {targetsQuery.isLoading ? (
            <ActivityIndicator color={tokens.neon.pink} />
          ) : targetsQuery.isError ? (
            <Button
              label="Retry"
              variant="secondary"
              onPress={() => targetsQuery.refetch()}
              loading={targetsQuery.isFetching}
            />
          ) : (
            targets.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                accessibilityLabel={`Impersonate ${t.email}`}
                onPress={busy ? undefined : () => onImpersonate(t.email)}
                testID={`admin-impersonation-option-${t.email}`}
                style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowHover]}
              >
                <Text variant="label" numberOfLines={1} style={styles.menuLabel}>
                  {t.email}
                </Text>
                {busy && target === t.email ? (
                  <ActivityIndicator size="small" color={tokens.neon.pink} />
                ) : null}
              </Pressable>
            ))
          )}
          <Button
            label="Cancel"
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setEditing(false);
              setTarget("");
            }}
          />
        </View>
      ) : (
        <MenuRow
          label="Impersonate a user"
          mark="none"
          testID="open-admin-impersonation"
          onPress={() => setEditing(true)}
        />
      )}
    </GutterRow>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: tokens.space.md, paddingBottom: tokens.space.xxl },
  identity: { paddingBottom: tokens.space.xl },
  name: { fontSize: 16, lineHeight: 24 },
  identityAction: { paddingTop: tokens.space.md, alignItems: "flex-start" },
  today: { flexDirection: "row", gap: tokens.space.xxl, paddingTop: tokens.space.md },
  stat: { gap: 2 },
  statValue: { fontSize: 24, lineHeight: 34 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 48,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  menuRowHover: { backgroundColor: tokens.bg.surface },
  menuLabel: { flex: 1, minWidth: 0 },
  admin: { paddingTop: tokens.space.xl },
  adminList: { gap: tokens.space.xs },
  version: {
    paddingTop: tokens.space.xxl,
    textAlign: "center",
  },
});
