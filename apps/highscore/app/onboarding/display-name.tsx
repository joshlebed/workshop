import { useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Wordmark } from "../../src/components/Wordmark";
import { useAuth } from "../../src/hooks/useAuth";
import { HsButton, HsText, hs } from "../../src/theme";

export default function DisplayName() {
  const { setDisplayName } = useAuth();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

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
        <View style={styles.brandBlock}>
          <Wordmark />
          <HsText tone="secondary">Pick a name for the leaderboard.</HsText>
        </View>
        <HsText variant="pixelTitle" style={styles.title}>
          Display name
        </HsText>
        <TextInput
          testID="display-name-input"
          value={value}
          onChangeText={setValue}
          placeholder="Ada Lovelace"
          placeholderTextColor={hs.color.textSecondary}
          autoFocus
          autoComplete="name"
          maxLength={40}
          style={[styles.input, focused && styles.inputFocused]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={handleSave}
          returnKeyType="done"
        />
        <HsButton
          testID="display-name-save"
          label="Continue"
          variant="primary"
          size="lg"
          disabled={!canSubmit}
          loading={busy}
          onPress={handleSave}
        />
        {error ? (
          <HsText tone="danger" style={styles.error}>
            {error}
          </HsText>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: hs.color.bg,
    paddingHorizontal: hs.space.xl,
    paddingVertical: hs.space.xxl,
    justifyContent: "center",
    gap: hs.space.xxl,
  },
  form: {
    gap: hs.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  brandBlock: { gap: hs.space.sm, marginBottom: hs.space.md },
  title: { fontSize: 14, lineHeight: 22 },
  input: {
    borderWidth: hs.bezel,
    borderColor: hs.color.border,
    borderRadius: hs.radius.hard,
    paddingHorizontal: hs.space.lg,
    paddingVertical: 14,
    color: hs.color.textPrimary,
    fontSize: hs.font.size.lg,
    backgroundColor: hs.color.surface2,
  },
  inputFocused: { borderColor: hs.color.primary },
  error: { textAlign: "center", marginTop: hs.space.xs },
});
