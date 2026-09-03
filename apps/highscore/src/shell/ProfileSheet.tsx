// "You" — a sheet off the header avatar, not a screen. Edit profile stays a
// route because it is a real form with account deletion in it.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { fetchImpersonationTargets } from "../api/users";
import { useAuth } from "../hooks/useAuth";
import { PRIVACY_ROUTE, SUPPORT_ROUTE } from "../lib/publicRoutes";
import { Avatar, Button, pixelType, Sheet, tokens, useToast } from "../theme";
import { Text } from "../theme/Text";

export interface ProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ProfileSheet({ visible, onClose }: ProfileSheetProps) {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();

  const onSendFeedback = () => {
    const subject = encodeURIComponent("HighScore feedback");
    const version = Constants.expoConfig?.version ?? "0.0.0";
    const body = encodeURIComponent(
      `\n\nFeedback context\nHighScore v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
    );
    Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(() => {});
  };

  // Impersonation swaps the whole session — close and drop every cached query
  // so no other user's data survives the switch.
  const onAuthSessionChanged = useCallback(() => {
    onClose();
    queryClient.clear();
  }, [onClose, queryClient]);

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="profile-menu-sheet">
      <View style={styles.identity}>
        <Avatar
          name={user?.displayName ?? user?.email ?? null}
          imageUrl={user?.avatarUrl ?? null}
          size="lg"
        />
        <View style={styles.identityText}>
          <Text numberOfLines={1} style={styles.name}>
            {(user?.displayName ?? "HighScore").toUpperCase()}
          </Text>
          <Text numberOfLines={1} style={styles.email}>
            {user?.email ?? ""}
          </Text>
        </View>
      </View>

      <View style={styles.rows}>
        <MenuRow
          label="Edit profile"
          testID="open-edit-profile"
          onPress={() => {
            onClose();
            router.push("/profile");
          }}
        />
        <MenuRow label="Send feedback" testID="send-feedback" onPress={onSendFeedback} />
        {/* Both are public pages (src/lib/publicRoutes.ts), so the in-app push
            lands on the same content Apple sees at the published URLs. */}
        <MenuRow
          label="Support"
          testID="open-support"
          onPress={() => {
            onClose();
            router.push(SUPPORT_ROUTE);
          }}
        />
        <MenuRow
          label="Privacy policy"
          testID="open-privacy"
          onPress={() => {
            onClose();
            router.push(PRIVACY_ROUTE);
          }}
        />
      </View>

      <AdminImpersonationRow onSessionChanged={onAuthSessionChanged} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        onPress={() => {
          onClose();
          void signOut();
        }}
        testID="sign-out"
        hitSlop={6}
        style={({ pressed }) => [styles.signOut, pressed && styles.dim]}
      >
        <Text style={styles.signOutLabel}>SIGN OUT</Text>
      </Pressable>
    </Sheet>
  );
}

function MenuRow({
  label,
  onPress,
  testID,
}: {
  label: string;
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
        styles.row,
        (pressed || hovered) && styles.rowHover,
      ]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

// Hidden unless the server says the signed-in user is an admin; the backend
// enforces the same gate on the target list and the impersonate endpoint, so
// this check is presentation-only.
function AdminImpersonationRow({ onSessionChanged }: { onSessionChanged: () => void }) {
  const { user, token, impersonation, impersonateUser, stopImpersonating } = useAuth();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const targetsQuery = useQuery({
    queryKey: queryKeys.users.impersonationTargets,
    queryFn: () => fetchImpersonationTargets(token),
    enabled: Boolean(user?.isAdmin && editing && token && !impersonation),
    staleTime: 60_000,
  });

  const labelFor = (u: { displayName: string | null; email: string | null }) =>
    u.displayName?.trim() || u.email || "user";

  const targets = targetsQuery.data?.users ?? [];
  const selectedTarget = targets.find((u) => u.email === target) ?? null;
  const loadingTargets = targetsQuery.isLoading || (targetsQuery.isFetching && !targetsQuery.data);
  const selectDisabled = busy || loadingTargets || targetsQuery.isError || targets.length === 0;

  const onImpersonate = async () => {
    const trimmed = target.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const nextUser = await impersonateUser(trimmed);
      showToast({ message: `Signed in as ${labelFor(nextUser)}`, tone: "success" });
      setEditing(false);
      setTarget("");
      setDropdownOpen(false);
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
      <View style={styles.admin} testID="admin-impersonation-status">
        <Text style={styles.email}>Impersonating. Started by {adminLabel}.</Text>
        <Button
          label="Stop impersonating"
          variant="secondary"
          loading={busy}
          onPress={onStop}
          testID="stop-impersonating"
        />
      </View>
    );
  }

  if (!user?.isAdmin) return null;

  if (!editing) {
    return (
      <View style={styles.admin}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Admin: impersonate user"
          onPress={() => setEditing(true)}
          testID="open-admin-impersonation"
          hitSlop={6}
          style={({ pressed }) => [pressed && styles.dim]}
        >
          <Text style={styles.adminLabel}>ADMIN: IMPERSONATE</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.admin} testID="admin-impersonation-form">
      <Pressable
        testID="admin-impersonation-select"
        accessibilityRole="button"
        accessibilityLabel="User to impersonate"
        accessibilityState={{ disabled: selectDisabled, expanded: dropdownOpen }}
        onPress={selectDisabled ? undefined : () => setDropdownOpen((o) => !o)}
        style={({ pressed }) => [
          styles.select,
          pressed && !selectDisabled ? styles.rowHover : null,
        ]}
      >
        <Text numberOfLines={1} style={styles.selectText}>
          {selectedTarget?.email ??
            (loadingTargets
              ? "Loading users..."
              : targetsQuery.isError
                ? "Couldn't load users"
                : targets.length === 0
                  ? "No users with email"
                  : "Select a user")}
        </Text>
      </Pressable>
      {dropdownOpen && !selectDisabled ? (
        <ScrollView style={styles.options} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
          {targets.map((targetUser) => (
            <Pressable
              key={targetUser.id}
              testID={`admin-impersonation-option-${targetUser.email}`}
              accessibilityRole="button"
              accessibilityLabel={`Impersonate ${targetUser.email}`}
              onPress={() => {
                setTarget(targetUser.email);
                setDropdownOpen(false);
              }}
              style={({ pressed }) => [styles.option, pressed && styles.rowHover]}
            >
              <Text numberOfLines={1} style={styles.rowLabel}>
                {targetUser.email}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {targetsQuery.isError ? (
        <Button
          label="Retry"
          size="md"
          variant="secondary"
          disabled={targetsQuery.isFetching}
          loading={targetsQuery.isFetching}
          onPress={() => targetsQuery.refetch()}
        />
      ) : null}
      <View style={styles.adminActions}>
        <Button
          label="Sign in"
          size="md"
          disabled={!target.trim() || busy}
          loading={busy}
          onPress={onImpersonate}
          testID="admin-impersonation-submit"
        />
        <Button
          label="Cancel"
          size="md"
          variant="ghost"
          disabled={busy}
          onPress={() => {
            setEditing(false);
            setTarget("");
            setDropdownOpen(false);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  name: { ...pixelType(13), color: tokens.text.primary },
  email: { fontSize: 12, lineHeight: 16, color: tokens.text.secondary },
  rows: { borderTopWidth: 1, borderTopColor: tokens.border.default },
  row: {
    minHeight: 44,
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
  },
  rowHover: { backgroundColor: tokens.bg.raised },
  rowLabel: { fontSize: 14, lineHeight: 18, color: tokens.text.primary },
  admin: { gap: tokens.space.sm },
  adminLabel: { ...pixelType(10), color: tokens.text.secondary },
  adminActions: { flexDirection: "row", gap: tokens.space.sm },
  select: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  selectText: { fontSize: 13, color: tokens.text.primary },
  options: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  option: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border.default,
  },
  signOut: { paddingTop: tokens.space.xs },
  signOutLabel: { ...pixelType(10), color: tokens.text.secondary },
  dim: { opacity: 0.6 },
});
