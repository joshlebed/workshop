import { useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useAuth } from "../../src/hooks/useAuth";
import { Button, Screen, Text, tokens } from "../../src/theme";

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
      <Screen style={styles.screen} testID="display-name">
        <View style={styles.form}>
          <Text variant="title" style={styles.title}>
            Enter your name
          </Text>
          <Text tone="secondary">This is the name on the board.</Text>
          <TextInput
            testID="display-name-input"
            value={value}
            onChangeText={setValue}
            placeholder="Ada Lovelace"
            placeholderTextColor={tokens.text.secondary}
            autoFocus
            autoComplete="name"
            maxLength={40}
            style={styles.input}
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
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  screen: { justifyContent: "center", paddingHorizontal: tokens.space.xl },
  form: { gap: tokens.space.md },
  title: { fontSize: 16, lineHeight: 26 },
  input: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 14,
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    backgroundColor: tokens.bg.surface,
  },
  error: { textAlign: "center" },
});
