// Your account, as a sheet over the timeline.
//
// This is the old profile menu and the old edit-profile screen collapsed into
// one surface. There was never enough on either to justify two screens and a
// navigation hop between them: your picture and name are the account, and the
// half-dozen links under them are the rest of it. The App Store 5.1.1(v)
// deletion control keeps its two-step inline confirmation at the bottom (rules
// live in `src/lib/accountDeletion.ts`, not in this component).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { fetchImpersonationTargets } from "../api/users";
import { useAuth } from "../hooks/useAuth";
import {
  ACCOUNT_DELETION_CONSEQUENCES,
  accountDeletionBlockReason,
  accountDeletionErrorMessage,
  type DeletionStep,
  nextDeletionStep,
} from "../lib/accountDeletion";
import { pickProfilePhoto } from "../lib/profilePhoto";
import { PRIVACY_ROUTE, SUPPORT_ROUTE } from "../lib/publicRoutes";
import { SheetFrame } from "../nav/SheetFrame";
import type { SheetNav } from "../nav/SheetHost";
import { Avatar, PixelIcon, Text, tokens, useToast } from "../theme";

export function AccountSheet({ nav }: { nav: SheetNav }) {
  const { user, updateProfile, signOut } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [busy, setBusy] = useState(false);

  const initialName = user?.displayName ?? "";
  const initialAvatar = user?.avatarUrl ?? null;
  const trimmed = name.trim();
  const nameChanged = trimmed !== initialName.trim();
  const avatarChanged = avatarUrl !== initialAvatar;
  const dirty = nameChanged || avatarChanged;
  const nameValid = trimmed.length >= 1 && trimmed.length <= 40;
  const canSave = dirty && nameValid && !busy;

  async function onPickPhoto() {
    const picked = await pickProfilePhoto();
    if (picked) setAvatarUrl(picked.dataUrl);
  }

  async function onSave() {
    if (!canSave) return;
    try {
      setBusy(true);
      // Send only what changed so an unchanged field is never re-validated or
      // re-written. `avatarUrl: null` clears the picture.
      const patch: { displayName?: string; avatarUrl?: string | null } = {};
      if (nameChanged) patch.displayName = trimmed;
      if (avatarChanged) patch.avatarUrl = avatarUrl;
      await updateProfile(patch);
      showToast({ message: "Profile updated", tone: "success" });
      setBusy(false);
    } catch (e) {
      showToast({ message: errorMessage(e, "Could not save profile"), tone: "danger" });
      setBusy(false);
    }
  }

  function onSendFeedback() {
    const subject = encodeURIComponent("HighScore feedback");
    const version = Constants.expoConfig?.version ?? "0.0.0";
    const body = encodeURIComponent(
      `\n\nFeedback context\nHighScore v${version} · ${Platform.OS}${user?.id ? ` · ${user.id.slice(0, 8)}` : ""}`,
    );
    Linking.openURL(`mailto:joshlebed@gmail.com?subject=${subject}&body=${body}`).catch(() => {});
  }

  return (
    <SheetFrame
      title={user?.displayName?.trim() || "You"}
      nav={nav}
      testID="account-sheet"
      meta={
        user?.email ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {user.email}
          </Text>
        ) : null
      }
    >
      <View style={styles.identity}>
        <Avatar
          name={trimmed || user?.email || null}
          imageUrl={avatarUrl}
          size="lg"
          style={styles.avatar}
          testID="profile-edit-avatar"
        />
        <View style={styles.identityActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={avatarUrl ? "Change photo" : "Upload photo"}
            onPress={onPickPhoto}
            testID="profile-photo-pick"
            style={({ pressed }) => [styles.quiet, pressed && styles.pressedFill]}
          >
            <Text variant="eyebrow" tone="link">
              {avatarUrl ? "Change photo" : "Upload photo"}
            </Text>
          </Pressable>
          {avatarUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={() => setAvatarUrl(null)}
              testID="profile-photo-remove"
              style={({ pressed }) => [styles.quiet, pressed && styles.pressedFill]}
            >
              <Text variant="eyebrow" tone="secondary">
                Remove
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.field}>
        <Text variant="eyebrow" tone="secondary">
          Display name
        </Text>
        <TextInput
          testID="profile-display-name"
          value={name}
          onChangeText={setName}
          placeholder="Ada Lovelace"
          placeholderTextColor={tokens.text.muted}
          autoComplete="name"
          maxLength={40}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={onSave}
        />
      </View>

      {dirty ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save changes"
          onPress={onSave}
          disabled={!canSave}
          testID="profile-save"
          style={({ pressed }) => [
            styles.save,
            !canSave && styles.saveOff,
            pressed && canSave && styles.pressedFill,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={tokens.neon.pink} />
          ) : (
            <Text variant="heading" tone={canSave ? "link" : "secondary"}>
              Save changes
            </Text>
          )}
        </Pressable>
      ) : null}

      {/* No icons: five rows of unrelated glyphs is decoration, and the top
          bar already owns the one navigation target worth an icon (friends). */}
      <View style={styles.menu}>
        <MenuRow label="Send feedback" testID="send-feedback" onPress={onSendFeedback} />
        <MenuRow label="Support" testID="open-support" onPress={() => router.push(SUPPORT_ROUTE)} />
        <MenuRow
          label="Privacy policy"
          testID="open-privacy"
          onPress={() => router.push(PRIVACY_ROUTE)}
        />
        <MenuRow
          label="Sign out"
          testID="sign-out"
          onPress={() => {
            nav.close();
            void signOut();
          }}
        />
      </View>

      <AdminImpersonationRow
        onSessionChanged={() => {
          nav.close();
          queryClient.clear();
        }}
      />

      <DeleteAccountSection />
    </SheetFrame>
  );
}

function MenuRow({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.menuRow,
        (pressed || hovered) && styles.pressedFill,
      ]}
    >
      <Text variant="heading" style={styles.menuLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

// Hidden unless the server says the signed-in user is an admin
// (`user.isAdmin`); the backend enforces the same gate on both the target list
// and the impersonate endpoint, so the client check is presentation-only.
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
      <View style={styles.adminBlock} testID="admin-impersonation-status">
        <Text variant="caption" tone="muted">
          Impersonating. Started by {adminLabel}.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop impersonating"
          onPress={onStop}
          disabled={busy}
          testID="stop-impersonating"
          style={({ pressed }) => [styles.outline, pressed && styles.pressedFill]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={tokens.text.primary} />
          ) : (
            <Text variant="eyebrow">Stop impersonating</Text>
          )}
        </Pressable>
      </View>
    );
  }

  if (!user?.isAdmin) return null;

  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Admin: impersonate user"
        onPress={() => setEditing(true)}
        testID="open-admin-impersonation"
        style={({ pressed }) => [styles.quiet, pressed && styles.pressedFill]}
      >
        <Text variant="eyebrow" tone="secondary">
          Admin · impersonate user
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.adminBlock} testID="admin-impersonation-form">
      <Pressable
        testID="admin-impersonation-select"
        accessibilityRole="button"
        accessibilityLabel="User to impersonate"
        accessibilityState={{ disabled: selectDisabled, expanded: dropdownOpen }}
        onPress={selectDisabled ? undefined : () => setDropdownOpen((o) => !o)}
        style={({ pressed }) => [
          styles.select,
          pressed && !selectDisabled ? styles.pressedFill : null,
        ]}
      >
        <Text variant="label" numberOfLines={1} style={styles.selectText}>
          {selectedTarget?.email ??
            (loadingTargets
              ? "Loading users..."
              : targetsQuery.isError
                ? "Couldn't load users"
                : targets.length === 0
                  ? "No users with email"
                  : "Select a user")}
        </Text>
        <PixelIcon
          name={dropdownOpen ? "chevron-up" : "chevron-down"}
          size={16}
          color={tokens.text.secondary}
        />
      </Pressable>
      {dropdownOpen && !selectDisabled ? (
        <ScrollView
          style={styles.optionList}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {targets.map((targetUser) => (
            <Pressable
              key={targetUser.id}
              testID={`admin-impersonation-option-${targetUser.email}`}
              accessibilityRole="button"
              accessibilityLabel={`Impersonate ${targetUser.email}`}
              accessibilityState={{ selected: targetUser.email === target }}
              onPress={() => {
                setTarget(targetUser.email);
                setDropdownOpen(false);
              }}
              style={({ pressed }) => [styles.option, pressed ? styles.pressedFill : null]}
            >
              <Text variant="label" numberOfLines={1}>
                {targetUser.email}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.adminActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in as user"
          onPress={onImpersonate}
          disabled={!target.trim() || busy}
          testID="admin-impersonation-submit"
          style={({ pressed }) => [styles.outline, pressed && styles.pressedFill]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={tokens.neon.pink} />
          ) : (
            <Text variant="eyebrow" tone={target.trim() ? "link" : "secondary"}>
              Sign in
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => {
            setEditing(false);
            setTarget("");
            setDropdownOpen(false);
          }}
          disabled={busy}
          style={({ pressed }) => [styles.quiet, pressed && styles.pressedFill]}
        >
          <Text variant="eyebrow" tone="secondary">
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Permanent account deletion, required in-app by App Store Review Guideline
 * 5.1.1(v). Two-step, inline: the consequences (including the shared
 * Workshop.dev account) stay on screen while the destructive button is visible,
 * and nothing stacks over the sheet the user opened this from.
 */
function DeleteAccountSection() {
  const { token, impersonation, deleteAccount } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<DeletionStep>("idle");

  const blocked = accountDeletionBlockReason({ token, impersonation });
  const deleting = step === "deleting";

  async function onConfirmDelete() {
    setStep((s) => nextDeletionStep(s, "submit"));
    try {
      await deleteAccount();
      // Every cached query belongs to an account that no longer exists.
      queryClient.clear();
      showToast({ message: "Account deleted", tone: "success" });
    } catch (e) {
      // The account still exists — say so instead of pretending otherwise.
      setStep((s) => nextDeletionStep(s, "failed"));
      showToast({ message: accountDeletionErrorMessage(e), tone: "danger" });
    }
  }

  return (
    <View style={styles.danger} testID="danger-zone">
      <Text variant="eyebrow" tone="secondary">
        Danger zone
      </Text>

      {step === "idle" ? (
        <>
          <Text variant="caption" tone="muted">
            Deleting removes your HighScore and Workshop.dev account and all of its data. This
            cannot be undone.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            onPress={
              blocked !== null ? undefined : () => setStep((s) => nextDeletionStep(s, "open"))
            }
            disabled={blocked !== null}
            testID="account-delete-open"
            style={({ pressed }) => [
              styles.dangerButton,
              blocked !== null && styles.dangerButtonOff,
              pressed && styles.pressedFill,
            ]}
          >
            <Text variant="eyebrow" tone={blocked !== null ? "muted" : "danger"}>
              Delete account
            </Text>
          </Pressable>
          {blocked === "impersonating" ? (
            <Text variant="caption" tone="muted" testID="account-delete-blocked">
              Stop impersonating before deleting an account.
            </Text>
          ) : null}
        </>
      ) : (
        <View style={styles.confirmCard} testID="account-delete-confirm-card">
          <Text variant="label">Delete your account permanently?</Text>
          {ACCOUNT_DELETION_CONSEQUENCES.map((line) => (
            <Text key={line} variant="caption" tone="secondary">
              • {line}
            </Text>
          ))}
          <View style={styles.adminActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
              onPress={onConfirmDelete}
              disabled={deleting}
              testID="account-delete-confirm"
              style={({ pressed }) => [styles.dangerButton, pressed && styles.pressedFill]}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={tokens.status.danger} />
              ) : (
                <Text variant="eyebrow" tone="danger">
                  Delete my account
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => setStep((s) => nextDeletionStep(s, "cancel"))}
              disabled={deleting}
              testID="account-delete-cancel"
              style={({ pressed }) => [styles.quiet, pressed && styles.pressedFill]}
            >
              <Text variant="eyebrow" tone="secondary">
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: "row", alignItems: "center", gap: tokens.space.lg },
  avatar: { width: 64, height: 64 },
  identityActions: { gap: tokens.space.xs, alignItems: "flex-start" },
  quiet: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    marginLeft: -tokens.space.sm,
    alignSelf: "flex-start",
  },
  pressedFill: { backgroundColor: tokens.bg.raised },
  field: { gap: tokens.space.xs, marginTop: tokens.space.sm },
  input: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    backgroundColor: tokens.bg.canvas,
  },
  save: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  saveOff: { borderColor: tokens.border.default },
  menu: { marginTop: tokens.space.md },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 44,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderTopWidth: tokens.bezel,
    borderTopColor: tokens.border.default,
  },
  menuLabel: { flex: 1, minWidth: 0, color: tokens.text.primary },
  adminBlock: { gap: tokens.space.sm, marginTop: tokens.space.sm },
  adminActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    flexWrap: "wrap",
  },
  select: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 44,
    paddingHorizontal: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  selectText: { flex: 1, minWidth: 0 },
  optionList: {
    maxHeight: 200,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  option: {
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  outline: {
    paddingHorizontal: tokens.space.md,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  danger: { marginTop: tokens.space.xl, gap: tokens.space.sm },
  dangerHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  dangerRule: {
    flex: 1,
    height: tokens.bezel,
    backgroundColor: tokens.status.danger,
    opacity: 0.4,
  },
  dangerButton: {
    paddingHorizontal: tokens.space.md,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  dangerButtonOff: { opacity: 0.5 },
  confirmCard: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.status.danger,
  },
});
