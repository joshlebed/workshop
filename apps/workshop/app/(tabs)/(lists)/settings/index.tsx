import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import {
  Avatar,
  confirm,
  ListRow,
  layout,
  Screen,
  ScreenHeader,
  SectionHeader,
  screenColumnStyle,
  Text,
  tokens,
} from "@workshop/ui";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, View } from "react-native";
import { fetchLists } from "../../../../src/api/lists";
import { KeyboardShortcutsSheet } from "../../../../src/components/KeyboardShortcutsSheet";
import { useAuth } from "../../../../src/hooks/useAuth";
import { useFinePointer } from "../../../../src/lib/finePointer";
import { goBack } from "../../../../src/lib/goBack";
import { AdminImpersonationRow } from "../../../../src/screens/settings/AdminImpersonation";
import { LetterboxdRow } from "../../../../src/screens/settings/LetterboxdRow";

/**
 * Settings (UX pass 3.5): a pushed screen of grouped rows that replaced the
 * profile sheet. You, Lists, Connections, About (feedback, privacy, terms,
 * version), Sign out, Delete account (4.5), and an Admin group at the very bottom for admins (and for an impersonated session, so "Stop
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
  // Keyboard shortcuts are listed only where there's a keyboard (5.7b).
  const finePointer = useFinePointer();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const name = user?.displayName?.trim() || "You";

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/")}
        leadingTestID="settings-back"
        title="Settings"
      />
      <ScrollView contentContainerStyle={[styles.body, screenColumnStyle]} testID="settings-screen">
        <Group title="You" first>
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
            // Named by its own text (name, email; WCAG 2.5.3); the hint says where it goes.
            accessibilityHint="Edit profile"
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

        <Group title="About">
          <ListRow title="Send feedback" chevron onPress={onFeedback} testID="settings-feedback" />
          <ListRow
            title="Privacy"
            chevron
            onPress={() => router.push("/privacy")}
            testID="settings-privacy"
          />
          <ListRow
            title="Terms"
            chevron
            onPress={() => router.push("/terms")}
            testID="settings-terms"
          />
          {finePointer ? (
            <ListRow
              title="Keyboard shortcuts"
              trailing={
                <Text variant="label" tone="muted">
                  ?
                </Text>
              }
              onPress={() => setShortcutsOpen(true)}
              testID="settings-shortcuts"
            />
          ) : null}
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

        {/* The destructive action alone, under a plain heading (DESIGN.md). */}
        <Group title="Delete account">
          <ListRow
            title={<Text style={styles.danger}>Delete account</Text>}
            subtitle="Also deletes your HighScore account"
            chevron
            onPress={() => router.push("/settings/delete-account")}
            testID="settings-delete-account"
          />
        </Group>

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
      <KeyboardShortcutsSheet visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </Screen>
  );
}

function Group({
  title,
  first,
  children,
}: {
  title: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View>
      <SectionHeader title={title} first={first} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  body: { paddingTop: layout.contentTopGap, paddingBottom: layout.bottomInset },
  // A group with no label (Sign out) keeps the section rhythm.
  group: { paddingTop: layout.sectionTop },
  // The row's leading slot is 44 everywhere (DESIGN.md Row).
  avatar: { width: 44, height: 44, borderRadius: tokens.radius.pill },
  danger: {
    color: tokens.status.danger,
    fontWeight: tokens.font.weight.medium,
    letterSpacing: tokens.font.tracking.heading,
  },
});
