import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { fetchFriendRequests } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { useLivePollingInterval } from "@workshop/api-client/useLivePollingInterval";
import { Avatar, Sheet, useToast } from "@workshop/ui";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { fetchImpersonationTargets } from "../api/users";
import { useAuth } from "../hooks/useAuth";
import { PRIVACY_ROUTE, SUPPORT_ROUTE } from "../lib/publicRoutes";
import { HsText, hsBezel, hsColor, hsSheet, hsSpace, PixelButton } from "../theme";

export function ProfileMenu() {
  const { token, user, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const livePoll = useLivePollingInterval();
  const [open, setOpen] = useState(false);
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token,
    refetchInterval: livePoll,
  });
  const pending = requestsQuery.data?.inbound.length ?? 0;

  const onSendFeedback = () => {
    const subject = encodeURIComponent("HighScore feedback");
    const version = Constants.expoConfig?.version ?? "0.0.0";
    const body = encodeURIComponent(
      `\n\nFeedback context\nHighScore v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
    );
    Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(() => {});
  };

  // Impersonation swaps the whole session — close the sheet and drop every
  // cached query so no other user's data leaks across accounts.
  const onAuthSessionChanged = useCallback(() => {
    setOpen(false);
    queryClient.clear();
  }, [queryClient]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pending > 0 ? `Profile, ${pending} friend requests` : "Profile"}
        onPress={() => setOpen(true)}
        testID="profile-menu-trigger"
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <Avatar
          name={user?.displayName ?? user?.email ?? null}
          imageUrl={user?.avatarUrl ?? null}
          size="md"
        />
        {pending > 0 ? (
          <View style={styles.badge}>
            <HsText variant="caption" tone="onNeon" style={styles.badgeText}>
              {pending > 9 ? "9+" : pending}
            </HsText>
          </View>
        ) : null}
      </Pressable>
      <Sheet
        visible={open}
        onRequestClose={() => setOpen(false)}
        contentStyle={hsSheet}
        testID="profile-menu-sheet"
      >
        <View style={styles.content}>
          <View style={styles.identity}>
            <Avatar
              name={user?.displayName ?? user?.email ?? null}
              imageUrl={user?.avatarUrl ?? null}
              size="lg"
            />
            <View style={styles.identityText}>
              <HsText variant="pixelHeading" numberOfLines={1}>
                {user?.displayName ?? "HighScore"}
              </HsText>
              <HsText variant="caption" tone="secondary" numberOfLines={1}>
                {user?.email ?? ""}
              </HsText>
            </View>
          </View>
          <PixelButton
            label="Edit profile"
            variant="secondary"
            testID="open-edit-profile"
            onPress={() => {
              setOpen(false);
              router.push("/profile");
            }}
          />
          <PixelButton
            label={pending > 0 ? `Friends (${pending})` : "Friends"}
            onPress={() => {
              setOpen(false);
              router.push("/friends");
            }}
          />
          <PixelButton
            label="Send feedback"
            variant="secondary"
            testID="send-feedback"
            onPress={onSendFeedback}
          />
          {/* Both routes are public pages (see src/lib/publicRoutes.ts), so the
              in-app push lands on the same content Apple sees at the published
              highscore.live URLs — on native and web alike. */}
          <PixelButton
            label="Support"
            variant="ghost"
            testID="open-support"
            onPress={() => {
              setOpen(false);
              router.push(SUPPORT_ROUTE);
            }}
          />
          <PixelButton
            label="Privacy policy"
            variant="ghost"
            testID="open-privacy"
            onPress={() => {
              setOpen(false);
              router.push(PRIVACY_ROUTE);
            }}
          />
          <AdminImpersonationRow onSessionChanged={onAuthSessionChanged} />
          <PixelButton
            label="Sign out"
            variant="ghost"
            testID="sign-out"
            onPress={() => {
              setOpen(false);
              void signOut();
            }}
          />
        </View>
      </Sheet>
    </>
  );
}

// Adapted copy of Workshop's AdminImpersonationRow. Hidden unless the server
// says the signed-in user is an admin (`user.isAdmin`); the backend enforces
// the same gate on both the target list and the impersonate endpoint, so the
// client check is presentation-only.
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
      <View style={impersonationStyles.form} testID="admin-impersonation-status">
        <HsText variant="caption" tone="secondary" style={impersonationStyles.note}>
          Impersonating. Started by {adminLabel}.
        </HsText>
        <PixelButton
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
      <PixelButton
        label="Admin: impersonate user"
        variant="secondary"
        onPress={() => setEditing(true)}
        testID="open-admin-impersonation"
      />
    );
  }

  return (
    <View style={impersonationStyles.form} testID="admin-impersonation-form">
      <Pressable
        testID="admin-impersonation-select"
        accessibilityRole="button"
        accessibilityLabel="User to impersonate"
        accessibilityState={{ disabled: selectDisabled, expanded: dropdownOpen }}
        onPress={selectDisabled ? undefined : () => setDropdownOpen((o) => !o)}
        style={({ pressed }) => [
          impersonationStyles.select,
          pressed && !selectDisabled ? impersonationStyles.selectPressed : null,
          selectDisabled ? impersonationStyles.selectDisabled : null,
        ]}
      >
        <HsText
          variant="label"
          numberOfLines={1}
          style={[
            impersonationStyles.selectText,
            !selectedTarget ? impersonationStyles.selectPlaceholder : null,
          ]}
        >
          {selectedTarget?.email ??
            (loadingTargets
              ? "Loading users..."
              : targetsQuery.isError
                ? "Couldn't load users"
                : targets.length === 0
                  ? "No users with email"
                  : "Select a user")}
        </HsText>
        <HsText variant="label" tone="secondary" style={impersonationStyles.selectChevron}>
          {dropdownOpen ? "⌃" : "⌄"}
        </HsText>
      </Pressable>
      {dropdownOpen && !selectDisabled ? (
        <ScrollView
          style={impersonationStyles.optionList}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {targets.map((targetUser) => {
            const selected = targetUser.email === target;
            const displayName = targetUser.displayName?.trim();
            return (
              <Pressable
                key={targetUser.id}
                testID={`admin-impersonation-option-${targetUser.email}`}
                accessibilityRole="button"
                accessibilityLabel={`Impersonate ${targetUser.email}`}
                accessibilityState={{ selected }}
                onPress={() => {
                  setTarget(targetUser.email);
                  setDropdownOpen(false);
                }}
                style={({ pressed }) => [
                  impersonationStyles.option,
                  selected ? impersonationStyles.optionSelected : null,
                  pressed ? impersonationStyles.optionPressed : null,
                ]}
              >
                <HsText variant="label" numberOfLines={1} style={impersonationStyles.optionEmail}>
                  {targetUser.email}
                </HsText>
                {displayName ? (
                  <HsText variant="caption" tone="secondary" numberOfLines={1}>
                    {displayName}
                  </HsText>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {targetsQuery.isError ? (
        <View style={impersonationStyles.retryRow}>
          <HsText variant="caption" tone="secondary" style={impersonationStyles.retryText}>
            User emails could not be loaded.
          </HsText>
          <PixelButton
            label="Retry"
            size="md"
            variant="secondary"
            disabled={targetsQuery.isFetching}
            loading={targetsQuery.isFetching}
            onPress={() => targetsQuery.refetch()}
          />
        </View>
      ) : null}
      <View style={impersonationStyles.actions}>
        <PixelButton
          label="Sign in"
          size="md"
          disabled={!target.trim() || busy}
          loading={busy}
          onPress={onImpersonate}
          testID="admin-impersonation-submit"
        />
        <PixelButton
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
  trigger: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
  },
  pressed: { backgroundColor: hsColor.surface2 },
  // Pending-requests count: a spotlight, so it wears the neon yellow.
  badge: {
    position: "absolute",
    right: 0,
    top: 0,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: hsColor.accent,
    borderWidth: 2,
    borderColor: hsColor.bg,
  },
  badgeText: { fontSize: 9, lineHeight: 11, fontWeight: "700" },
  content: { gap: hsSpace.md },
  identity: { flexDirection: "row", alignItems: "center", gap: hsSpace.md },
  identityText: { flex: 1, minWidth: 0 },
});

const impersonationStyles = StyleSheet.create({
  form: { gap: hsSpace.sm },
  select: {
    minHeight: 44,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
    borderRadius: 0,
    paddingHorizontal: hsSpace.md,
    paddingVertical: 10,
    backgroundColor: hsColor.surface2,
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.sm,
  },
  selectPressed: { backgroundColor: hsColor.surface3 },
  selectDisabled: { borderColor: hsColor.border, opacity: 0.6 },
  selectText: { flex: 1, minWidth: 0, color: hsColor.textPrimary },
  selectPlaceholder: { color: hsColor.textSecondary },
  selectChevron: {
    width: 18,
    textAlign: "center",
    color: hsColor.textSecondary,
  },
  optionList: {
    maxHeight: 220,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
    borderRadius: 0,
    backgroundColor: hsColor.surface2,
  },
  option: {
    paddingHorizontal: hsSpace.md,
    paddingVertical: hsSpace.sm,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: hsColor.border,
  },
  optionPressed: { backgroundColor: hsColor.surface3 },
  optionSelected: { backgroundColor: `${hsColor.primary}22` },
  optionEmail: { color: hsColor.textPrimary },
  retryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.sm,
    flexWrap: "wrap",
  },
  retryText: { flex: 1, minWidth: 160 },
  actions: { flexDirection: "row", gap: hsSpace.sm, flexWrap: "wrap" },
  note: { paddingHorizontal: hsSpace.xs },
});
