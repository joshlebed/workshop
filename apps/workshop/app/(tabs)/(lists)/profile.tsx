import { errorMessage } from "@workshop/api-client/api";
import {
  Avatar,
  Button,
  Screen,
  ScreenHeader,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "../../../src/hooks/useAuth";
import { goBack } from "../../../src/lib/goBack";
import { pickProfilePhoto } from "../../../src/lib/profilePhoto";

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
      <ScreenHeader
        leading="close"
        onLeadingPress={() => goBack("/")}
        leadingLabel="Close profile editor"
        leadingTestID="profile-edit-close"
        eyebrow="Account"
        title="Edit profile"
      />

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

        <TextField
          label="Display name"
          hint="Shown to people on your shared lists."
          testID="profile-display-name"
          value={name}
          onChangeText={setName}
          placeholder="Ada Lovelace"
          autoComplete="name"
          maxLength={40}
          inputStyle={styles.input}
          returnKeyType="done"
          onSubmitEditing={onSave}
        />

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
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: {
    paddingTop: tokens.space.md,
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
  input: { fontSize: tokens.font.size.lg, paddingVertical: tokens.space.md },
  saveButton: { marginTop: tokens.space.sm },
});
