import { useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useAuth } from "../../src/hooks/useAuth";
import { Button, Text, tokens } from "../../src/ui/index";

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
      <View style={styles.intro}>
        <Text variant="caption" tone="muted" style={styles.eyebrow}>
          One quick thing
        </Text>
        <Text variant="title" style={styles.heading}>
          What should we call you?
        </Text>
        <Text tone="secondary" style={styles.tagline}>
          This is how you'll show up to people you share lists with. Change it later in settings.
        </Text>
      </View>

      <View style={styles.form}>
        <Text variant="label" tone="secondary" style={styles.label}>
          Display name
        </Text>
        <TextInput
          testID="display-name-input"
          value={value}
          onChangeText={setValue}
          placeholder="Ada Lovelace"
          placeholderTextColor={tokens.text.muted}
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
  intro: {
    gap: tokens.space.sm,
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
  },
  eyebrow: { letterSpacing: 0.3 },
  heading: { letterSpacing: -0.4 },
  tagline: { fontSize: tokens.font.size.md, lineHeight: 22 },
  form: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  label: { letterSpacing: -0.1, fontSize: tokens.font.size.sm },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 14,
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    backgroundColor: tokens.bg.surface,
  },
  error: { textAlign: "center", marginTop: tokens.space.xs },
});
