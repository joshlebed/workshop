// HighScore's edit-profile screen. Adapted copy of apps/workshop's — same
// PATCH /v1/users/me contract, HighScore-owned presentation.

import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { Avatar, IconButton, Screen, useToast } from "@workshop/ui";
import { goBack } from "@workshop/ui/navigation";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "../hooks/useAuth";
import {
  ACCOUNT_DELETION_CONSEQUENCES,
  accountDeletionBlockReason,
  accountDeletionErrorMessage,
  type DeletionStep,
  nextDeletionStep,
} from "../lib/accountDeletion";
import { pickProfilePhoto } from "../lib/profilePhoto";
import { HsText, hsBezel, hsColor, hsSpace, PixelButton, PixelDivider, PixelIcon } from "../theme";

export default function EditProfile() {
  const { user, updateProfile } = useAuth();
  const { showToast } = useToast();

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
      goBack("/");
    } catch (e) {
      showToast({ message: errorMessage(e, "Could not save profile"), tone: "danger" });
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <HsText variant="caption" tone="secondary" style={styles.headerEyebrow}>
            Account
          </HsText>
          <HsText variant="pixelHeading" numberOfLines={1}>
            Edit profile
          </HsText>
        </View>
        <IconButton
          accessibilityLabel="Close profile editor"
          onPress={() => goBack("/")}
          testID="profile-edit-close"
        >
          <PixelIcon name="close" size={16} color={hsColor.textSecondary} />
        </IconButton>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={hsSpace.lg}
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
            <PixelButton
              testID="profile-photo-pick"
              label={avatarUrl ? "Change photo" : "Upload photo"}
              variant="secondary"
              size="md"
              onPress={onPickPhoto}
            />
            {avatarUrl ? (
              <PixelButton
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
          <HsText variant="caption" tone="secondary">
            Display name
          </HsText>
          <TextInput
            testID="profile-display-name"
            value={name}
            onChangeText={setName}
            placeholder="Ada Lovelace"
            placeholderTextColor={hsColor.textSecondary}
            autoComplete="name"
            maxLength={40}
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
          <HsText variant="caption" tone="secondary" style={styles.hint}>
            Shown to friends on your leaderboards.
          </HsText>
        </View>

        {user?.email ? (
          <View style={styles.field}>
            <HsText variant="caption" tone="secondary">
              Email
            </HsText>
            <HsText tone="secondary" numberOfLines={1}>
              {user.email}
            </HsText>
          </View>
        ) : null}

        <PixelButton
          testID="profile-save"
          label="Save changes"
          size="lg"
          disabled={!canSave}
          loading={busy}
          onPress={onSave}
          style={styles.saveButton}
        />

        <DeleteAccountSection />
      </KeyboardAwareScrollView>
    </Screen>
  );
}

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
      <PixelDivider style={dangerStyles.divider} />
      <HsText variant="caption" tone="secondary" style={dangerStyles.eyebrow}>
        Danger zone
      </HsText>

      {step === "idle" ? null : (
        <View style={dangerStyles.confirmCard} testID="account-delete-confirm-card">
          <HsText variant="label">Delete your account permanently?</HsText>
          {ACCOUNT_DELETION_CONSEQUENCES.map((line) => (
            <HsText key={line} variant="caption" tone="secondary">
              • {line}
            </HsText>
          ))}
          <View style={dangerStyles.confirmActions}>
            <PixelButton
              testID="account-delete-confirm"
              label="Delete my account"
              variant="danger"
              size="md"
              loading={deleting}
              disabled={deleting}
              onPress={onConfirmDelete}
            />
            <PixelButton
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
          <HsText variant="caption" tone="secondary">
            Deleting removes your HighScore and Workshop.dev account and all of its data. This
            cannot be undone.
          </HsText>
          <PixelButton
            testID="account-delete-open"
            label="Delete account"
            variant="danger"
            size="md"
            disabled={blocked !== null}
            onPress={() => setStep((s) => nextDeletionStep(s, "open"))}
          />
          {blocked === "impersonating" ? (
            <HsText variant="caption" tone="secondary" testID="account-delete-blocked">
              Stop impersonating before deleting an account.
            </HsText>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: hsColor.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: hsSpace.lg,
    paddingTop: hsSpace.lg,
    paddingBottom: hsSpace.md,
    gap: hsSpace.md,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  headerEyebrow: { letterSpacing: 1, textTransform: "uppercase" },
  body: {
    paddingHorizontal: hsSpace.lg,
    paddingBottom: hsSpace.xxl,
    gap: hsSpace.xl,
  },
  avatarSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.lg,
  },
  avatarPreview: { width: 72, height: 72, borderRadius: 36 },
  avatarButtons: { flex: 1, gap: hsSpace.sm },
  field: { gap: hsSpace.sm },
  input: {
    borderWidth: hsBezel,
    borderColor: hsColor.border,
    borderRadius: 0,
    paddingHorizontal: hsSpace.lg,
    paddingVertical: 14,
    color: hsColor.textPrimary,
    fontSize: 18,
    backgroundColor: hsColor.surface2,
  },
  hint: { marginTop: hsSpace.xs },
  saveButton: { marginTop: hsSpace.sm },
});

const dangerStyles = StyleSheet.create({
  section: { gap: hsSpace.sm, marginTop: hsSpace.lg },
  divider: { marginBottom: hsSpace.md },
  eyebrow: { letterSpacing: 1, textTransform: "uppercase" },
  confirmCard: {
    gap: hsSpace.sm,
    padding: hsSpace.lg,
    borderRadius: 0,
    borderWidth: hsBezel,
    borderColor: hsColor.danger,
    backgroundColor: hsColor.surface1,
  },
  confirmActions: {
    flexDirection: "row",
    gap: hsSpace.sm,
    flexWrap: "wrap",
    marginTop: hsSpace.xs,
  },
});
