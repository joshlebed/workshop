// HighScore's "You" page (/profile): edit your profile up top, then
// blocked users, then settings / help / legal / sign out, with account
// deletion last. Reached straight from the home-header avatar — there is
// no menu sheet in between.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { goBack } from "@workshop/ui/navigation";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { ImpersonationStatus } from "../admin/ImpersonationPanel";
import { blockedUsersQueryKey, fetchBlockedUsers, unblockUser } from "../api/moderation";
import { useAuth } from "../hooks/useAuth";
import {
  ACCOUNT_DELETION_CONSEQUENCES,
  accountDeletionBlockReason,
  accountDeletionErrorMessage,
  type DeletionStep,
  nextDeletionStep,
} from "../lib/accountDeletion";
import { pickProfilePhoto } from "../lib/profilePhoto";
import { PRIVACY_ROUTE, SUPPORT_ROUTE, TERMS_ROUTE } from "../lib/publicRoutes";
import {
  Avatar,
  Button,
  bodyType,
  IconButton,
  PixelIcon,
  type PixelIconName,
  Screen,
  Text,
  tokens,
  useToast,
} from "../theme";

export default function EditProfile() {
  const { user, updateProfile } = useAuth();
  const { showToast } = useToast();
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
      // Standings rows build their avatar URL from the server's per-user
      // `avatarVersion`; refetch so the viewer's own rows pick up the new
      // picture now, not on the next poll/focus.
      if (avatarChanged) void queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({ message: "Profile updated", tone: "success" });
      goBack("/");
    } catch (e) {
      showToast({ message: errorMessage(e, "Could not save profile"), tone: "danger" });
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <IconButton
          accessibilityLabel="Back"
          onPress={() => goBack("/")}
          testID="profile-edit-close"
        >
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </IconButton>
        <Text variant="heading" numberOfLines={1} style={styles.headerText}>
          You
        </Text>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        <View style={styles.avatarSection}>
          <Avatar
            name={trimmed || user?.email || null}
            imageUrl={avatarUrl}
            size="lg"
            style={styles.avatarPreview}
            testID="profile-edit-avatar"
          />
          <View style={styles.avatarButtons}>
            <Button
              testID="profile-photo-pick"
              label={avatarUrl ? "Change photo" : "Upload photo"}
              variant="secondary"
              size="md"
              onPress={onPickPhoto}
            />
            {avatarUrl ? (
              <Button
                testID="profile-photo-remove"
                label="Remove"
                variant="secondary"
                size="md"
                onPress={() => setAvatarUrl(null)}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.field}>
          <Text variant="caption" tone="muted">
            Display name
          </Text>
          <TextInput
            testID="profile-display-name"
            value={name}
            onChangeText={setName}
            placeholder="Ada Lovelace"
            placeholderTextColor={tokens.text.secondary}
            autoComplete="name"
            maxLength={40}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
          <Text variant="caption" tone="muted" style={styles.hint}>
            Shown to friends on your leaderboards.
          </Text>
        </View>

        {user?.email ? (
          <View style={styles.field}>
            <Text variant="caption" tone="muted">
              Email
            </Text>
            <Text tone="secondary" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        ) : null}

        <Button
          testID="profile-save"
          label="Save changes"
          size="lg"
          disabled={!canSave}
          loading={busy}
          onPress={onSave}
          style={styles.saveButton}
        />

        <BlockedUsersSection />
        <SettingsSection />
        <DeleteAccountSection />
      </KeyboardAwareScrollView>
    </Screen>
  );
}

/**
 * Everything that used to live in the profile menu sheet: help, legal, admin
 * and sign out, as a quiet row list under your profile. Rare actions, so one
 * extra scroll is fine; the daily surfaces (home, friends) never show them.
 */
function SettingsSection() {
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

  // Impersonation swaps the whole session — drop every cached query so no
  // other user's data leaks across accounts, then land on home.
  const onAuthSessionChanged = useCallback(() => {
    queryClient.clear();
    goBack("/");
  }, [queryClient]);

  return (
    <View style={dangerStyles.section} testID="profile-settings">
      <View style={dangerStyles.divider} />
      <Text variant="caption" tone="muted" style={dangerStyles.eyebrow}>
        Settings
      </Text>
      <View style={settingsStyles.list}>
        <SettingsRow
          icon="mail"
          label="Send feedback"
          onPress={onSendFeedback}
          testID="send-feedback"
        />
        {/* Public pages (src/lib/publicRoutes.ts): the in-app push lands on the
            same content Apple sees at the published highscore.live URLs. */}
        <SettingsRow
          icon="link"
          label="Support"
          onPress={() => router.push(SUPPORT_ROUTE)}
          testID="open-support"
        />
        <SettingsRow
          label="Privacy policy"
          onPress={() => router.push(PRIVACY_ROUTE)}
          testID="open-privacy"
        />
        <SettingsRow
          label="Terms of use"
          onPress={() => router.push(TERMS_ROUTE)}
          testID="open-terms"
        />
        {user?.isAdmin ? (
          <SettingsRow
            icon="sliders"
            label="Admin dashboard"
            onPress={() => router.push("/admin")}
            testID="open-admin"
          />
        ) : null}
      </View>
      <ImpersonationStatus onSessionChanged={onAuthSessionChanged} />
      <Button label="Sign out" variant="ghost" testID="sign-out" onPress={() => void signOut()} />
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
  testID,
}: {
  icon?: PixelIconName;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed, hovered }) => [
        settingsStyles.row,
        (pressed || hovered) && settingsStyles.rowHover,
      ]}
    >
      {icon ? (
        <PixelIcon name={icon} size={24} color={tokens.text.secondary} />
      ) : (
        <View style={settingsStyles.iconSlot} />
      )}
      <Text style={settingsStyles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} />
    </Pressable>
  );
}

const settingsStyles = StyleSheet.create({
  list: { marginHorizontal: -tokens.space.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    minHeight: 48,
  },
  rowHover: { backgroundColor: tokens.bg.surface },
  rowLabel: { flex: 1, minWidth: 0 },
  iconSlot: { width: 24, height: 24 },
});

/**
 * Who you've blocked (App Store Review Guideline 1.2), with an Unblock per row.
 * Unblocking does not restore the friendship — they'd have to be re-added.
 */
function BlockedUsersSection() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: blockedUsersQueryKey,
    queryFn: () => fetchBlockedUsers(token),
    enabled: !!token,
  });
  const unblock = useMutation({
    mutationFn: (userId: string) => unblockUser(userId, token),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: blockedUsersQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["friends"] }),
      ]);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't unblock that user."), tone: "danger" });
    },
  });
  const blocked = query.data?.blocked ?? [];

  return (
    <View style={dangerStyles.section} testID="blocked-users">
      <View style={dangerStyles.divider} />
      <Text variant="caption" tone="muted" style={dangerStyles.eyebrow}>
        Blocked users
      </Text>
      {blocked.length === 0 ? (
        <Text variant="caption" tone="muted">
          {query.isError
            ? "Couldn't load your blocked users."
            : "Nobody blocked. Block someone from their profile and they'll show up here."}
        </Text>
      ) : (
        blocked.map((b) => (
          <View key={b.userId} style={blockedStyles.row} testID={`blocked-user-${b.userId}`}>
            <Avatar name={b.displayName} size="sm" />
            <Text style={blockedStyles.name} numberOfLines={1}>
              {b.displayName?.trim() || "Someone"}
            </Text>
            <Button
              label="Unblock"
              variant="secondary"
              size="md"
              disabled={unblock.isPending}
              onPress={() => unblock.mutate(b.userId)}
              testID={`unblock-${b.userId}`}
            />
          </View>
        ))
      )}
    </View>
  );
}

const blockedStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  name: { flex: 1, minWidth: 0 },
});

/**
 * Permanent account deletion, required in-app by App Store Review Guideline
 * 5.1.1(v). Lives at the bottom of the account screen — one tap from the
 * profile menu — behind a two-step, inline confirmation rather than a modal:
 * the consequences (including the shared Workshop.dev account) stay on screen
 * while the destructive button is visible, and nothing stacks over the sheet
 * the user opened this screen from.
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
      // No navigation needed: the auth gate sends a signed-out session to the
      // sign-in screen as soon as the context flips. No restart required.
    } catch (e) {
      // The account still exists — say so instead of pretending otherwise, and
      // leave the confirmation open so the user can retry or back out.
      setStep((s) => nextDeletionStep(s, "failed"));
      showToast({ message: accountDeletionErrorMessage(e), tone: "danger" });
    }
  }

  return (
    <View style={dangerStyles.section} testID="danger-zone">
      <View style={dangerStyles.divider} />
      <Text variant="caption" tone="muted" style={dangerStyles.eyebrow}>
        Danger zone
      </Text>

      {step === "idle" ? null : (
        <View style={dangerStyles.confirmCard} testID="account-delete-confirm-card">
          <Text variant="label">Delete your account permanently?</Text>
          {ACCOUNT_DELETION_CONSEQUENCES.map((line) => (
            <Text key={line} variant="caption" tone="secondary">
              • {line}
            </Text>
          ))}
          <View style={dangerStyles.confirmActions}>
            <Button
              testID="account-delete-confirm"
              label="Delete my account"
              variant="danger"
              size="md"
              loading={deleting}
              disabled={deleting}
              onPress={onConfirmDelete}
            />
            <Button
              testID="account-delete-cancel"
              label="Cancel"
              variant="ghost"
              size="md"
              disabled={deleting}
              onPress={() => setStep((s) => nextDeletionStep(s, "cancel"))}
            />
          </View>
        </View>
      )}
      {step === "idle" ? (
        <>
          <Text variant="caption" tone="muted">
            Deleting removes your HighScore and Workshop.dev account and all of its data. This
            cannot be undone.
          </Text>
          <Button
            testID="account-delete-open"
            label="Delete account"
            variant="danger"
            size="md"
            disabled={blocked !== null}
            onPress={() => setStep((s) => nextDeletionStep(s, "open"))}
          />
          {blocked === "impersonating" ? (
            <Text variant="caption" tone="muted" testID="account-delete-blocked">
              Stop impersonating before deleting an account.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.sm,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.sm,
    gap: tokens.space.sm,
  },
  headerText: { flex: 1, minWidth: 0 },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  avatarSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.lg,
  },
  avatarPreview: { width: 72, height: 72, borderRadius: 36 },
  avatarButtons: { flex: 1, gap: tokens.space.sm },
  field: { gap: tokens.space.sm },
  input: {
    ...bodyType(),
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 14,
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    backgroundColor: tokens.bg.elevated,
  },
  hint: { marginTop: tokens.space.xs },
  saveButton: { marginTop: tokens.space.sm },
});

const dangerStyles = StyleSheet.create({
  section: { gap: tokens.space.sm, marginTop: tokens.space.lg },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.default,
    marginBottom: tokens.space.md,
  },
  eyebrow: { letterSpacing: 0.4, textTransform: "uppercase" },
  confirmCard: {
    gap: tokens.space.sm,
    padding: tokens.space.lg,
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.status.danger,
    backgroundColor: tokens.bg.surface,
  },
  confirmActions: {
    flexDirection: "row",
    gap: tokens.space.sm,
    flexWrap: "wrap",
    marginTop: tokens.space.xs,
  },
});
