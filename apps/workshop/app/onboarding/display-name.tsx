import { Button, Text, TextField, tokens } from "@workshop/ui";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useAuth } from "../../src/hooks/useAuth";

export default function DisplayName() {
  const { setDisplayName } = useAuth();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 40 && !busy;

  async function handleSave() {
    if (!canSubmit) return;
    try {
      setBusy(true);
      setError(null);
      await setDisplayName(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.form}>
        <TextField
          label="Display name"
          testID="display-name-input"
          value={value}
          onChangeText={setValue}
          placeholder="Ada Lovelace"
          autoFocus
          autoComplete="name"
          maxLength={40}
          inputStyle={styles.input}
          onSubmitEditing={handleSave}
          returnKeyType="done"
        />
        <Button
          testID="display-name-save"
          label="Continue"
          size="lg"
          disabled={!canSubmit}
          loading={busy}
          onPress={handleSave}
        />
        {error ? (
          <Text tone="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.xxl,
    justifyContent: "center",
    gap: tokens.space.xxl,
  },
  form: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  input: { fontSize: tokens.font.size.lg, paddingVertical: tokens.space.md },
  error: { textAlign: "center", marginTop: tokens.space.xs },
});
