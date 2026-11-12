import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import {
  Avatar,
  confirm,
  ListRow,
  Screen,
  ScreenHeader,
  SectionHeader,
  Text,
  tokens,
} from "@workshop/ui";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Linking, Platform, ScrollView, StyleSheet, View } from "react-native";
import { fetchLists } from "../../../../src/api/lists";
import { useAuth } from "../../../../src/hooks/useAuth";
import { goBack } from "../../../../src/lib/goBack";
import { AdminImpersonationRow } from "../../../../src/screens/settings/AdminImpersonation";
import { LetterboxdRow } from "../../../../src/screens/settings/LetterboxdRow";

/**
 * Settings (UX pass 3.5): a pushed screen of grouped rows that replaced the
 * profile sheet. You, Lists, Connections, About, Sign out, and an Admin group
 * at the very bottom for admins (and for an impersonated session, so "Stop
 * impersonating" stays reachable).
 */
export default function Settings() {
  const { user, token, impersonation, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const version = Constants.expoConfig?.version ?? "0.0.0";

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });
  const hiddenCount = (listsQuery.data?.lists ?? []).filter((l) => !!l.archivedAt).length;

  const onSignOut = async () => {
    const ok = await confirm({
      title: "Sign out?",
      message: "You'll need to sign in again to see your lists.",
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (ok) void signOut();
  };

  const onFeedback = () => {
    const subject = encodeURIComponent("Workshop feedback");
    const body = encodeURIComponent(
      `\n\nFeedback context\nWorkshop v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
    );
    Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(() => {});
  };

  // Impersonating or stopping swaps the whole session: drop every cached
  // query and go home, where the new identity's lists load.
  const onSessionChanged = useCallback(() => {
    queryClient.clear();
    router.dismissTo("/");
  }, [queryClient, router]);

  const showAdmin = !!user?.isAdmin || !!impersonation;
  const name = user?.displayName?.trim() || "You";

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID="settings-back"
        title="Settings"
      />
      <ScrollView contentContainerStyle={styles.body} testID="settings-screen">
        <Group title="You">
          <ListRow
            leading={
              <Avatar
                name={user?.displayName ?? user?.email ?? null}
                imageUrl={user?.avatarUrl}
                size="lg"
                style={styles.avatar}
              />
            }
            title={name}
            subtitle={user?.email ?? undefined}
            chevron
            onPress={() => router.push("/profile")}
            accessibilityLabel={`Edit profile, ${name}`}
            testID="settings-profile"
          />
        </Group>

        <Group title="Lists">
          <ListRow
            title="Hidden lists"
            subtitle={hiddenCount === 0 ? "None hidden" : `${hiddenCount} hidden from home`}
            chevron
            onPress={() => router.push("/settings/hidden")}
            testID="settings-hidden-lists"
          />
        </Group>

        <Group title="Connections">
          <LetterboxdRow />
        </Group>

        {/* Phase 4 (4.5) adds Privacy, Terms and Delete account to this group. */}
        <Group title="About">
          <ListRow title="Send feedback" chevron onPress={onFeedback} testID="settings-feedback" />
          <ListRow
            title="Version"
            trailing={
              <Text variant="label" tone="muted" testID="settings-version">
                {version}
              </Text>
            }
          />
        </Group>

        <View style={styles.group}>
          <ListRow title="Sign out" onPress={() => void onSignOut()} testID="sign-out" />
        </View>

        {showAdmin ? (
          <Group title="Admin">
            {user?.isAdmin ? (
              <ListRow
                title="Analytics"
                chevron
                onPress={() => router.push("/admin/analytics")}
                testID="open-admin-analytics"
              />
            ) : null}
            <AdminImpersonationRow onSessionChanged={onSessionChanged} />
          </Group>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <SectionHeader title={title} style={styles.groupHeader} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { paddingBottom: tokens.space.xxl * 2 },
  group: { paddingTop: tokens.space.lg },
  groupHeader: { paddingHorizontal: tokens.space.lg, paddingBottom: tokens.space.xs },
  avatar: { width: 48, height: 48, borderRadius: 24 },
});
