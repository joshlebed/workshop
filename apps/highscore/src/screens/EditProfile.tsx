// HighScore's "You" page (/profile): your picture and name up top, then the
// quiet lists — account facts, help, legal, admin, sign out — and account
// deletion last. Reached straight from the home-header avatar; there is no
// menu sheet in between. Same nav grammar as the Friends page.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { goBack } from "@workshop/ui/navigation";
import Constants from "expo-constants";
import { type Href, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  type TextStyle,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { ImpersonationStatus } from "../admin/ImpersonationPanel";
import { blockedUsersQueryKey, fetchBlockedUsers, unblockUser } from "../api/moderation";
import { useAuth } from "../hooks/useAuth";
import { SHARE_SETUP_SUPPORTED } from "../hooks/useShareAnnouncement";
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
  glow,
  IconButton,
  PixelIcon,
  Screen,
  sectionLabelType,
  Text,
  tokens,
  useToast,
} from "../theme";

export default function EditProfile() {
  const { user, updateProfile } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [name, setName] = useState(user?.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  function onDiscard() {
    setName(initialName);
    setAvatarUrl(initialAvatar);
    setSaveError(null);
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
      setSaveError(null);
      setBusy(false);
    } catch (e) {
      // Say it where the user is looking, not only in a toast that fades.
      setSaveError(errorMessage(e, "Could not save your profile. Try again."));
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.root} testID="you-screen">
      <View style={styles.headerNav}>
        <IconButton
          accessibilityLabel="Back"
          onPress={() => goBack("/")}
          testID="profile-edit-close"
        >
          <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
        </IconButton>
        <Text variant="title">You</Text>
        <View style={styles.navSpacer} />
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={tokens.space.lg}
      >
        {/* Identity: the picture is the hero; its actions are quiet text links. */}
        <View style={styles.identity}>
          <Avatar
            name={trimmed || user?.email || null}
            imageUrl={avatarUrl}
            size="xl"
            testID="profile-edit-avatar"
          />
          <View style={styles.identityActions}>
            <TextAction
              testID="profile-photo-pick"
              label={avatarUrl ? "Change photo" : "Add a photo"}
              onPress={onPickPhoto}
            />
            {avatarUrl ? (
              <TextAction
                testID="profile-photo-remove"
                label="Remove photo"
                tone="secondary"
                onPress={() => setAvatarUrl(null)}
              />
            ) : null}
          </View>
        </View>

        <View style={styles.field}>
          <Text variant="label" tone="secondary">
            Display name
          </Text>
          <TextInput
            testID="profile-display-name"
            value={name}
            onChangeText={setName}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            placeholder="Your name"
            placeholderTextColor={tokens.text.secondary}
            autoComplete="name"
            maxLength={40}
            style={[styles.input, nameFocused && styles.inputFocused]}
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
          <View style={styles.hintRow}>
            <Text variant="caption" tone="secondary" style={styles.hintText}>
              {trimmed.length === 0
                ? "Pick a name so friends can find you on the board."
                : "How you appear on your friends' leaderboards."}
            </Text>
            {name.length >= 30 ? (
              <Text variant="caption" tone={name.length >= 40 ? "danger" : "secondary"}>
                {name.length}/40
              </Text>
            ) : null}
          </View>
          {saveError ? (
            <Text variant="caption" tone="danger" testID="profile-save-error">
              {saveError}
            </Text>
          ) : null}
          {dirty ? (
            <View style={styles.saveRow} testID="profile-save-row">
              <Button
                testID="profile-save"
                label="Save changes"
                size="md"
                disabled={!canSave}
                loading={busy}
                onPress={onSave}
              />
              <Button
                testID="profile-discard"
                label="Discard"
                variant="ghost"
                size="md"
                disabled={busy}
                onPress={onDiscard}
              />
            </View>
          ) : null}
        </View>

        <Group title="Account">
          {user?.email ? <InfoRow label="Email" value={user.email} testID="profile-email" /> : null}
          <LinkRow
            label="Notifications"
            onPress={() => router.push("/settings/notifications")}
            testID="open-notification-settings"
          />
          {SHARE_SETUP_SUPPORTED ? (
            <LinkRow
              label="Share sheet"
              detail="Post from any game's Share button"
              onPress={() => router.push("/share-setup" as Href)}
              testID="profile-share-setup"
            />
          ) : null}
          <BlockedUsersRow />
        </Group>

        <SettingsGroups />
        <DeleteAccountSection />
      </KeyboardAwareScrollView>
    </Screen>
  );
}

/**
 * Everything that used to live in the profile menu sheet: help, legal, admin
 * and sign out, as quiet ruled rows under your profile. Rare actions, so one
 * extra scroll is fine; the daily surfaces (home, friends) never show them.
 */
function SettingsGroups() {
  const { user, impersonation, signOut } = useAuth();
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
    <View style={styles.groupStack} testID="profile-settings">
      <Group title="Help">
        <LinkRow label="Send feedback" onPress={onSendFeedback} testID="send-feedback" />
        {/* Public pages (src/lib/publicRoutes.ts): the in-app push lands on the
            same content Apple sees at the published highscore.live URLs. */}
        <LinkRow label="Support" onPress={() => router.push(SUPPORT_ROUTE)} testID="open-support" />
      </Group>
      <Group title="Legal">
        <LinkRow
          label="Privacy policy"
          onPress={() => router.push(PRIVACY_ROUTE)}
          testID="open-privacy"
        />
        <LinkRow
          label="Terms of use"
          onPress={() => router.push(TERMS_ROUTE)}
          testID="open-terms"
        />
      </Group>
      {user?.isAdmin || impersonation ? (
        <Group title="Admin">
          {user?.isAdmin ? (
            <LinkRow
              label="Admin dashboard"
              onPress={() => router.push("/admin")}
              testID="open-admin"
            />
          ) : null}
          <ImpersonationStatus onSessionChanged={onAuthSessionChanged} />
        </Group>
      ) : null}
      <View style={styles.signOutRow}>
        <Button
          label="Sign out"
          variant="ghost"
          size="md"
          onPress={() => void signOut()}
          testID="sign-out"
        />
      </View>
    </View>
  );
}

/** An overline plus its ruled rows. Groups are separated by the body gap; rows inside are tight. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View>{children}</View>
    </View>
  );
}

/** One quiet settings row: label, optional detail, chevron. Same shape as the Friends rows. */
function LinkRow({
  label,
  detail,
  onPress,
  testID,
  chevron = true,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  testID: string;
  chevron?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed, hovered }) => [styles.row, (pressed || hovered) && styles.rowHover]}
    >
      <View style={styles.rowText}>
        <Text numberOfLines={1}>{label}</Text>
        {detail ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {chevron ? <PixelIcon name="chevron-right" size={16} color={tokens.text.secondary} /> : null}
    </Pressable>
  );
}

/** Read-only fact: label left, value right. */
function InfoRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={styles.rowText} numberOfLines={1}>
        {label}
      </Text>
      <Text tone="secondary" numberOfLines={1} style={styles.rowValue}>
        {value}
      </Text>
    </View>
  );
}

/** Small text-link action (photo actions). Pink = tappable, per DESIGN.md. */
function TextAction({
  label,
  onPress,
  testID,
  tone = "link",
}: {
  label: string;
  onPress: () => void;
  testID: string;
  tone?: "link" | "secondary";
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} hitSlop={8}>
      {({ pressed, hovered }) => (
        <Text variant="label" tone={tone} style={(pressed || hovered) && styles.textActionHover}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * Who you've blocked (App Store Review Guideline 1.2), as a row with the
 * count that expands inline; Unblock per person. Unblocking does not restore
 * the friendship — they'd have to be re-added.
 */
function BlockedUsersRow() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
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
  const count = query.isError ? "?" : String(blocked.length);

  return (
    <View testID="blocked-users">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Blocked users, ${count}`}
        onPress={() => setOpen((o) => !o)}
        testID="blocked-users-toggle"
        style={({ pressed, hovered }) => [styles.row, (pressed || hovered) && styles.rowHover]}
      >
        <Text style={styles.rowText} numberOfLines={1}>
          Blocked users
        </Text>
        <Text tone="secondary" style={styles.rowValue}>
          {count}
        </Text>
        <PixelIcon
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={tokens.text.secondary}
        />
      </Pressable>
      {open ? (
        <View style={blockedStyles.panel}>
          {blocked.length === 0 ? (
            <Text variant="caption" tone="secondary">
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
      ) : null}
    </View>
  );
}

const blockedStyles = StyleSheet.create({
  panel: { paddingTop: tokens.space.sm, paddingBottom: tokens.space.md, gap: tokens.space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  name: { flex: 1, minWidth: 0 },
});

/**
 * Permanent account deletion, required in-app by App Store Review Guideline
 * 5.1.1(v). Last thing on the page, behind a two-step inline confirmation
 * rather than a modal: the consequences (including the shared Workshop.dev
 * account) stay on screen while the destructive button is visible.
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
    <View style={[styles.group, dangerStyles.section]} testID="danger-zone">
      <Text style={styles.sectionLabel}>Delete account</Text>

      {step === "idle" ? null : (
        <View style={dangerStyles.confirmCard} testID="account-delete-confirm-card">
          <Text variant="label">Delete your account permanently?</Text>
          {ACCOUNT_DELETION_CONSEQUENCES.map((line) => (
            <View key={line} style={dangerStyles.consequence}>
              <Text variant="caption" tone="danger">
                ·
              </Text>
              <Text variant="caption" tone="secondary" style={dangerStyles.consequenceText}>
                {line}
              </Text>
            </View>
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
          <Text variant="caption" tone="secondary">
            Deleting removes your HighScore and Workshop.dev account and all of its data. This
            cannot be undone.
          </Text>
          <View style={dangerStyles.actionRow}>
            <Button
              testID="account-delete-open"
              label="Delete account"
              variant="danger"
              size="md"
              disabled={blocked !== null}
              onPress={() => setStep((s) => nextDeletionStep(s, "open"))}
            />
          </View>
          {blocked === "impersonating" ? (
            <Text variant="caption" tone="secondary" testID="account-delete-blocked">
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
  // Same nav as the Friends page: back · centered title · spacer.
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navSpacer: { width: 40, height: 40 },
  // Rhythm: the identity block gets the most air (it is the point of the
  // page); the name field sits close under it; the lists below share one
  // steady beat.
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.xxl * 2,
    gap: tokens.space.xl,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xl,
    paddingVertical: tokens.space.sm,
  },
  identityActions: { flex: 1, gap: tokens.space.md },
  textActionHover: { opacity: 0.7 },
  field: { gap: tokens.space.sm, paddingBottom: tokens.space.sm },
  hintRow: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.md },
  hintText: { flex: 1, minWidth: 0 },
  saveRow: { flexDirection: "row", gap: tokens.space.sm, paddingTop: tokens.space.xs },
  // A group is a small section label + ruled rows. Rows are tight; groups are
  // separated by the body gap.
  groupStack: { gap: tokens.space.xl },
  group: { gap: tokens.space.xs },
  sectionLabel: { ...sectionLabelType(), color: tokens.text.secondary },
  // Ghost button padding would indent the label past the row text; pull it back.
  signOutRow: {
    alignItems: "flex-start",
    paddingTop: tokens.space.xs,
    marginLeft: -tokens.space.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 48,
    marginHorizontal: -tokens.space.sm,
    paddingHorizontal: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.default,
  },
  rowHover: { backgroundColor: tokens.bg.surface },
  rowText: { flex: 1, minWidth: 0 },
  rowValue: { flexShrink: 1, textAlign: "right" },
  input: {
    ...bodyType(),
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 14,
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    backgroundColor: tokens.bg.elevated,
  },
  // Focused input per DESIGN.md: pink bezel + glow, and no browser outline on top.
  inputFocused: {
    borderColor: tokens.neon.pink,
    ...(glow(tokens.neon.pinkGlow, 8) as TextStyle),
  },
});

const dangerStyles = StyleSheet.create({
  section: { gap: tokens.space.sm },
  actionRow: { flexDirection: "row" },
  consequence: { flexDirection: "row", gap: tokens.space.sm },
  consequenceText: { flex: 1, minWidth: 0 },
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
