import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemKind, ListSummary, ModuleName } from "@workshop/shared";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { fetchFriendRequests } from "../api/friends";
import { unarchiveList } from "../api/lists";
import { fetchImpersonationTargets } from "../api/users";
import { useAuth } from "../hooks/useAuth";
import { useLivePollingInterval } from "../hooks/useLivePollingInterval";
import { errorMessage } from "../lib/api";
import { confirm } from "../lib/confirm";
import { GAMES_TAB_ENABLED } from "../lib/featureFlags";
import { queryKeys } from "../lib/queryKeys";
import { Avatar, Button, type ListColorKey, Sheet, Text, tokens, useToast } from "../ui/index";

const KIND_LABEL: Partial<Record<ItemKind, string>> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  link: "Links",
  spotify_album: "Album shelf",
  plain: "List",
};

function summaryLabel(list: { itemKind: ItemKind | null; modules: ModuleName[] }): string {
  if (list.itemKind && KIND_LABEL[list.itemKind]) return KIND_LABEL[list.itemKind]!;
  if (list.modules.includes("leaderboard")) return "Leaderboard";
  if (list.modules.includes("todo")) return "Checklist";
  return "List";
}

// "Apr 2026". Falls back to year-only for ancient invalid dates so we never
// surface "since Jan 1970" if the server hands back a zero timestamp.
function formatMemberSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2024) return "early access";
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

type PressableState = {
  pressed?: boolean;
  hovered?: boolean;
};

export function ProfileMenu({ archivedLists }: { archivedLists: ListSummary[] }) {
  const { user, token, signOut } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [profileOpen, setProfileOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [openArchivedAfterProfileClose, setOpenArchivedAfterProfileClose] = useState(false);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);
  const livePoll = useLivePollingInterval();

  // Pending inbound friend requests — badges the avatar trigger and the
  // Friends button so a request isn't invisible until the friends page opens.
  const requestsQuery = useQuery({
    queryKey: queryKeys.friends.requests,
    queryFn: () => fetchFriendRequests(token),
    enabled: !!token && GAMES_TAB_ENABLED,
    refetchInterval: livePoll,
  });
  const inboundRequestCount = requestsQuery.data?.inbound.length ?? 0;

  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => {
      setUnarchivingId(id);
      return unarchiveList(id, token);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't unarchive list."), tone: "danger" });
    },
    onSettled: () => {
      setUnarchivingId(null);
    },
  });

  const onSignOut = async () => {
    setProfileOpen(false);
    const ok = await confirm({
      title: "Sign out?",
      message: "You'll need to sign in again to access your lists.",
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (ok) signOut();
  };

  const onAuthSessionChanged = useCallback(() => {
    setProfileOpen(false);
    setArchivedOpen(false);
    setOpenArchivedAfterProfileClose(false);
    queryClient.clear();
  }, [queryClient]);

  return (
    <>
      {/* Badge sits on a wrapper — the trigger itself clips (overflow hidden). */}
      <View style={styles.profileButtonWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile and settings"
          onPress={() => setProfileOpen(true)}
          testID="open-profile"
          style={({ pressed, hovered }: PressableState) => [
            styles.profileButton,
            (pressed || hovered) && styles.profileButtonPressed,
          ]}
        >
          <Avatar
            name={user?.displayName ?? user?.email ?? null}
            imageUrl={user?.avatarUrl}
            size="md"
            style={styles.profileAvatar}
          />
        </Pressable>
        {inboundRequestCount > 0 ? (
          <View style={styles.requestBadge} pointerEvents="none" testID="friend-request-badge">
            <Text style={styles.requestBadgeText} tone="onAccent">
              {inboundRequestCount > 9 ? "9+" : String(inboundRequestCount)}
            </Text>
          </View>
        ) : null}
      </View>

      <Sheet
        visible={profileOpen}
        onRequestClose={() => setProfileOpen(false)}
        onClosed={() => {
          if (!openArchivedAfterProfileClose) return;
          setOpenArchivedAfterProfileClose(false);
          setArchivedOpen(true);
        }}
        testID="profile-sheet"
      >
        <View style={styles.profileSheetHeader}>
          <Avatar
            name={user?.displayName ?? user?.email ?? null}
            imageUrl={user?.avatarUrl}
            size="lg"
            testID="profile-sheet-avatar"
          />
          <View style={styles.profileSheetIdentity}>
            <Text variant="heading" numberOfLines={1}>
              {user?.displayName?.trim() || "You"}
            </Text>
            {user?.email ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
            {user?.letterboxdUsername ? (
              <Text variant="caption" tone="muted" numberOfLines={1} testID="profile-letterboxd">
                Letterboxd: @{user.letterboxdUsername}
              </Text>
            ) : null}
            {user?.createdAt ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                On Workshop since {formatMemberSince(user.createdAt)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.profileSheetActions}>
          <Button
            label="Edit profile"
            variant="secondary"
            onPress={() => {
              setProfileOpen(false);
              router.push("/profile");
            }}
            testID="open-edit-profile"
          />
          {GAMES_TAB_ENABLED ? (
            <Button
              label={
                inboundRequestCount > 0
                  ? `Friends (${inboundRequestCount} ${inboundRequestCount === 1 ? "request" : "requests"})`
                  : "Friends"
              }
              variant="secondary"
              onPress={() => {
                setProfileOpen(false);
                router.push("/friends");
              }}
              testID="open-friends"
            />
          ) : null}
          {archivedLists.length > 0 ? (
            <Button
              label={`Archived lists (${archivedLists.length})`}
              variant="secondary"
              onPress={() => {
                setOpenArchivedAfterProfileClose(true);
                setProfileOpen(false);
              }}
              testID="open-archived"
            />
          ) : null}
          <Button
            label="Send feedback"
            variant="secondary"
            onPress={() => {
              const subject = encodeURIComponent("Workshop feedback");
              const version = Constants.expoConfig?.version ?? "0.0.0";
              const body = encodeURIComponent(
                `\n\nFeedback context\nWorkshop v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
              );
              Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(
                () => {},
              );
            }}
            testID="send-feedback"
          />
          <AdminImpersonationRow onSessionChanged={onAuthSessionChanged} />
          <LetterboxdAccountRow />
        </View>
        <View style={styles.profileSheetDivider} />
        <Button label="Sign out" variant="ghost" onPress={onSignOut} testID="sign-out" />
        <Text variant="caption" tone="muted" style={styles.profileSheetVersion}>
          Workshop · v{Constants.expoConfig?.version ?? "0.0.0"}
        </Text>
      </Sheet>

      <Sheet
        visible={archivedOpen}
        onRequestClose={() => setArchivedOpen(false)}
        testID="archived-sheet"
      >
        <View>
          <Text variant="heading" style={styles.archivedHeading}>
            Archived lists
          </Text>
          <Text variant="caption" tone="muted" style={styles.archivedSub}>
            Hidden from home. Unarchive to bring them back.
          </Text>
          {archivedLists.length === 0 ? (
            <Text tone="muted" style={styles.archivedEmpty}>
              Nothing archived.
            </Text>
          ) : (
            <View style={styles.archivedList}>
              {archivedLists.map((l) => {
                const accent = tokens.list[l.color as ListColorKey] ?? tokens.accent.default;
                const busy = unarchiveMutation.isPending && unarchivingId === l.id;
                return (
                  <View key={l.id} style={styles.archivedRow}>
                    <View
                      style={[
                        styles.archivedAvatar,
                        { backgroundColor: `${accent}26`, borderColor: `${accent}3D` },
                      ]}
                    >
                      <Text style={styles.avatarEmoji}>{l.emoji}</Text>
                    </View>
                    <View style={styles.archivedText}>
                      <Text variant="label" numberOfLines={1} style={styles.archivedTitle}>
                        {l.name}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {summaryLabel(l)} ·{" "}
                        {l.itemCount === 0
                          ? "empty"
                          : `${l.itemCount} ${l.itemCount === 1 ? "item" : "items"}`}
                      </Text>
                    </View>
                    <Button
                      label="Unarchive"
                      size="md"
                      variant="secondary"
                      loading={busy}
                      disabled={unarchiveMutation.isPending && !busy}
                      onPress={() => unarchiveMutation.mutate(l.id)}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </Sheet>
    </>
  );
}

/**
 * Account-level Letterboxd connection, managed from the profile sheet.
 * Collapsed: one button ("Connect Letterboxd" / "Change Letterboxd account").
 * Expanded: inline username input + save, plus disconnect when connected.
 * The username powers every Letterboxd-match list the user is a member of.
 */
function LetterboxdAccountRow() {
  const { user, connectLetterboxd, disconnectLetterboxd } = useAuth();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const connected = user?.letterboxdUsername ?? null;

  const onSave = async () => {
    const name = username.trim();
    if (!name) return;
    setBusy(true);
    try {
      const filmCount = await connectLetterboxd(name);
      showToast({
        message: `Letterboxd connected: ${filmCount} ${filmCount === 1 ? "film" : "films"} on your watchlist`,
        tone: "success",
      });
      setEditing(false);
      setUsername("");
    } catch (e) {
      showToast({
        message: errorMessage(e, "Couldn't connect that Letterboxd account."),
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Letterboxd?",
      message: "Match lists stop seeing your watchlist. Films already on lists stay.",
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await disconnectLetterboxd();
      showToast({ message: "Letterboxd disconnected", tone: "default" });
      setEditing(false);
    } catch (e) {
      showToast({ message: errorMessage(e, "Couldn't disconnect."), tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <Button
        label={connected ? `Change Letterboxd (@${connected})` : "Connect Letterboxd"}
        variant="secondary"
        onPress={() => setEditing(true)}
        testID="letterboxd-account-row"
      />
    );
  }
  return (
    <View style={accountActionStyles.form}>
      <TextInput
        testID="letterboxd-account-input"
        value={username}
        onChangeText={setUsername}
        placeholder={connected ? `@${connected}` : "Letterboxd username"}
        placeholderTextColor={tokens.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        accessibilityLabel="Letterboxd username"
        style={accountActionStyles.input}
        onSubmitEditing={onSave}
      />
      <View style={accountActionStyles.actions}>
        <Button
          label="Save"
          size="md"
          disabled={!username.trim() || busy}
          loading={busy}
          onPress={onSave}
          testID="letterboxd-account-save"
        />
        {connected ? (
          <Button
            label="Disconnect"
            size="md"
            variant="secondary"
            disabled={busy}
            onPress={onDisconnect}
            testID="letterboxd-account-disconnect"
          />
        ) : null}
        <Button label="Cancel" size="md" variant="ghost" onPress={() => setEditing(false)} />
      </View>
    </View>
  );
}

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
      <View style={accountActionStyles.form} testID="admin-impersonation-status">
        <Text variant="caption" tone="muted" style={accountActionStyles.note}>
          Impersonating. Started by {adminLabel}.
        </Text>
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
      <Button
        label="Admin: impersonate user"
        variant="secondary"
        onPress={() => setEditing(true)}
        testID="open-admin-impersonation"
      />
    );
  }

  return (
    <View style={accountActionStyles.form} testID="admin-impersonation-form">
      <Pressable
        testID="admin-impersonation-select"
        accessibilityRole="button"
        accessibilityLabel="User to impersonate"
        accessibilityState={{ disabled: selectDisabled, expanded: dropdownOpen }}
        onPress={selectDisabled ? undefined : () => setDropdownOpen((open) => !open)}
        style={({ pressed }) => [
          accountActionStyles.select,
          pressed && !selectDisabled ? accountActionStyles.selectPressed : null,
          selectDisabled ? accountActionStyles.selectDisabled : null,
        ]}
      >
        <Text
          variant="label"
          numberOfLines={1}
          style={[
            accountActionStyles.selectText,
            !selectedTarget ? accountActionStyles.selectPlaceholder : null,
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
        </Text>
        <Text variant="label" tone="muted" style={accountActionStyles.selectChevron}>
          {dropdownOpen ? "⌃" : "⌄"}
        </Text>
      </Pressable>
      {dropdownOpen && !selectDisabled ? (
        <ScrollView
          style={accountActionStyles.optionList}
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
                  accountActionStyles.option,
                  selected ? accountActionStyles.optionSelected : null,
                  pressed ? accountActionStyles.optionPressed : null,
                ]}
              >
                <Text variant="label" numberOfLines={1} style={accountActionStyles.optionEmail}>
                  {targetUser.email}
                </Text>
                {displayName ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {displayName}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {targetsQuery.isError ? (
        <View style={accountActionStyles.retryRow}>
          <Text variant="caption" tone="muted" style={accountActionStyles.retryText}>
            User emails could not be loaded.
          </Text>
          <Button
            label="Retry"
            size="md"
            variant="secondary"
            disabled={targetsQuery.isFetching}
            loading={targetsQuery.isFetching}
            onPress={() => targetsQuery.refetch()}
          />
        </View>
      ) : null}
      <View style={accountActionStyles.actions}>
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
  profileButtonWrap: { width: 40, height: 40 },
  requestBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: tokens.accent.default,
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
  requestBadgeText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: tokens.font.weight.bold,
  },
  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: tokens.border.default,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
    overflow: "hidden",
  },
  profileButtonPressed: { backgroundColor: tokens.bg.elevated },
  profileAvatar: { width: 38, height: 38, borderRadius: 19 },
  profileSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    marginBottom: tokens.space.lg,
  },
  profileSheetIdentity: { flex: 1, minWidth: 0, gap: 2 },
  profileSheetActions: { gap: tokens.space.sm },
  profileSheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginTop: tokens.space.lg,
    marginBottom: tokens.space.sm,
  },
  profileSheetVersion: {
    textAlign: "center",
    marginTop: tokens.space.lg,
    letterSpacing: 0.4,
  },
  archivedHeading: { paddingBottom: tokens.space.xs },
  archivedSub: { paddingBottom: tokens.space.md },
  archivedEmpty: {
    paddingVertical: tokens.space.lg,
    textAlign: "center",
  },
  archivedList: { gap: tokens.space.sm },
  archivedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.sm,
  },
  archivedAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  archivedText: { flex: 1, minWidth: 0 },
  archivedTitle: { color: tokens.text.primary },
  avatarEmoji: { fontSize: 20, lineHeight: 24 },
});

const accountActionStyles = StyleSheet.create({
  form: { gap: tokens.space.sm },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 10,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    backgroundColor: tokens.bg.surface,
  },
  select: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 10,
    backgroundColor: tokens.bg.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  selectPressed: { backgroundColor: tokens.bg.elevated },
  selectDisabled: { borderColor: tokens.border.subtle },
  selectText: { flex: 1, minWidth: 0, color: tokens.text.primary },
  selectPlaceholder: { color: tokens.text.muted },
  selectChevron: {
    width: 18,
    textAlign: "center",
    color: tokens.text.muted,
  },
  optionList: {
    maxHeight: 220,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  option: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  optionPressed: { backgroundColor: tokens.bg.elevated },
  optionSelected: { backgroundColor: tokens.accent.muted },
  optionEmail: { color: tokens.text.primary },
  retryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    flexWrap: "wrap",
  },
  retryText: { flex: 1, minWidth: 160 },
  actions: { flexDirection: "row", gap: tokens.space.sm, flexWrap: "wrap" },
  note: { paddingHorizontal: tokens.space.xs },
});
