import {
  Avatar,
  Button,
  layout,
  Screen,
  ScreenHeader,
  screenColumnStyle,
  Text,
  TextField,
  tokens,
  useToast,
} from "@workshop/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useAuth } from "../../../src/hooks/useAuth";
import { FAILURE_TOAST_KEY, failureMessage } from "../../../src/lib/errorCopy";
import { goBack } from "../../../src/lib/goBack";
import { pickProfilePhoto } from "../../../src/lib/profilePhoto";

const AUTOSAVE_DEBOUNCE_MS = 700;

/**
 * Edit profile (3.5). Edits autosave like item detail: the name on a 700ms
 * debounce (and on blur, and when leaving), the photo as soon as it is picked
 * or removed, with a quiet "Saved" in the header. Nothing to discard.
 */
export default function EditProfile() {
  const { user, updateProfile } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState(user?.displayName ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [photoBusy, setPhotoBusy] = useState(false);

  const savedName = (user?.displayName ?? "").trim();
  const nameRef = useRef(name);
  nameRef.current = name;
  const savedNameRef = useRef(savedName);
  savedNameRef.current = savedName;
  const inflightRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = name.trim();
  const nameError =
    trimmed.length === 0 ? "A name is needed so people on your lists know who you are." : null;

  const flushName = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = nameRef.current.trim();
    if (next.length === 0 || next.length > 40) return;
    if (next === savedNameRef.current || next === inflightRef.current) return;
    inflightRef.current = next;
    setStatus("saving");
    updateProfile({ displayName: next })
      .then(() => setStatus("saved"))
      .catch((e) => {
        setStatus("idle");
        showToast({
          key: FAILURE_TOAST_KEY,
          message: failureMessage(e, "Couldn't save your name."),
          tone: "danger",
        });
      })
      .finally(() => {
        inflightRef.current = null;
      });
  }, [updateProfile, showToast]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (trimmed === savedName || trimmed.length === 0) return;
    timerRef.current = setTimeout(flushName, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [trimmed, savedName, flushName]);

  // Fade "Saved" out a moment after the last save lands.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 1800);
    return () => clearTimeout(t);
  }, [status]);

  // Leaving (back, swipe back, browser back) never drops the last keystrokes.
  useEffect(() => () => flushName(), [flushName]);

  const savePhoto = async (avatarUrl: string | null) => {
    setPhotoBusy(true);
    setStatus("saving");
    try {
      await updateProfile({ avatarUrl });
      setStatus("saved");
    } catch (e) {
      setStatus("idle");
      showToast({
        key: FAILURE_TOAST_KEY,
        message: failureMessage(e, "Couldn't save your photo."),
        tone: "danger",
      });
    } finally {
      setPhotoBusy(false);
    }
  };

  const onPickPhoto = async () => {
    const picked = await pickProfilePhoto();
    if (picked) await savePhoto(picked.dataUrl);
  };

  const onBack = () => {
    flushName();
    goBack("/settings");
  };

  const avatarUrl = user?.avatarUrl ?? null;

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={onBack}
        leadingTestID="profile-edit-back"
        title="Profile"
        trailing={
          status === "idle" ? null : (
            <Text variant="caption" tone="muted" style={styles.saved} testID="profile-save-status">
              {status === "saving" ? "Saving…" : "Saved"}
            </Text>
          )
        }
      />

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.body, screenColumnStyle]}
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
              loading={photoBusy}
              disabled={photoBusy}
              onPress={() => void onPickPhoto()}
            />
            {avatarUrl ? (
              <Button
                testID="profile-photo-remove"
                label="Remove photo"
                variant="ghost"
                disabled={photoBusy}
                onPress={() => void savePhoto(null)}
              />
            ) : null}
          </View>
        </View>

        <TextField
          label="Display name"
          hint={nameError ? undefined : "Shown to people on your shared lists."}
          error={nameError ?? undefined}
          testID="profile-display-name"
          value={name}
          onChangeText={setName}
          onBlur={() => {
            if (trimmed.length === 0) setName(savedName);
            else setName(trimmed);
            flushName();
          }}
          placeholder="Your name"
          autoComplete="name"
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={flushName}
        />

        {user?.email ? (
          <View style={styles.field}>
            <Text variant="label" tone="secondary">
              Email
            </Text>
            <Text tone="secondary" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: {
    paddingTop: tokens.space.md,
    paddingHorizontal: layout.gutter,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.xl,
  },
  saved: { paddingHorizontal: tokens.space.sm },
  avatarSection: { flexDirection: "row", alignItems: "center", gap: tokens.space.lg },
  avatarPreview: { width: 72, height: 72, borderRadius: tokens.radius.pill },
  avatarButtons: { flex: 1, gap: tokens.space.sm, alignItems: "flex-start" },
  field: { gap: tokens.space.xs },
});
