import { Button, Screen, Text, TextField, tokens } from "@workshop/ui";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useAuth } from "../../src/hooks/useAuth";
import { DISPLAY_NAME_MAX } from "../../src/lib/displayNameSuggestion";
import { isNetworkError } from "../../src/lib/errorCopy";

/**
 * The one question a new account answers (4.1). Shown only when the
 * provider shared no name (the server saves it when there is one); the field
 * starts with whatever name the client did see. Return submits. "Use a
 * different account" signs out, for the person who picked the wrong Apple ID.
 */
export default function DisplayName() {
  const { setDisplayName, signOut, suggestedDisplayName } = useAuth();
  const [value, setValue] = useState(suggestedDisplayName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const canSubmit = trimmed.length >= 1 && trimmed.length <= DISPLAY_NAME_MAX && !busy;

  async function handleSave() {
    if (!canSubmit) return;
    try {
      setBusy(true);
      setError(null);
      await setDisplayName(trimmed);
    } catch (e) {
      setError(
        isNetworkError(e)
          ? "Couldn't save your name. Check your connection and try again."
          : "Couldn't save that name. Try a different one.",
      );
      setBusy(false);
    }
  }

  return (
    <Screen style={styles.root}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.form}>
          <View style={styles.intro}>
            <Text variant="title">What should people call you?</Text>
            <Text tone="secondary">
              People on the lists you share see this name next to what you add.
            </Text>
          </View>
          <TextField
            label="Your name"
            testID="display-name-input"
            value={value}
            onChangeText={setValue}
            placeholder="First name is fine"
            autoFocus
            autoComplete="name"
            textContentType="name"
            autoCapitalize="words"
            maxLength={DISPLAY_NAME_MAX}
            onSubmitEditing={() => void handleSave()}
            returnKeyType="done"
            error={error ?? undefined}
          />
          <Button
            testID="display-name-save"
            label="Continue"
            size="lg"
            disabled={!canSubmit}
            loading={busy}
            onPress={() => void handleSave()}
          />
          <Button
            testID="display-name-switch-account"
            label="Use a different account"
            variant="ghost"
            size="md"
            disabled={busy}
            onPress={() => void signOut()}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  fill: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.xxl,
  },
  form: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  intro: { gap: tokens.space.sm, marginBottom: tokens.space.sm },
});
