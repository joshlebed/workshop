import { useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Wordmark } from "../../src/components/Wordmark";
import { useAuth } from "../../src/hooks/useAuth";
import { Button, bezel, colors, font, radius, space, Text } from "../../src/theme";

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
        <View style={styles.brandBlock}>
          <Wordmark />
          <Text tone="secondary">Pick a name for the leaderboard.</Text>
        </View>
        <Text variant="label" tone="secondary" style={styles.label}>
          Display name
        </Text>
        <TextInput
          testID="display-name-input"
          value={value}
          onChangeText={setValue}
          placeholder="Ada Lovelace"
          placeholderTextColor={colors.textSecondary}
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
    backgroundColor: colors.bg,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxl,
    justifyContent: "center",
    gap: space.xxl,
  },
  form: {
    gap: space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  brandBlock: { gap: space.sm, marginBottom: space.md },
  label: { fontSize: font.size.sm },
  input: {
    borderWidth: bezel,
    borderColor: colors.border,
    borderRadius: radius.soft,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    color: colors.textPrimary,
    fontSize: font.size.lg,
    backgroundColor: colors.surface1,
  },
  error: { textAlign: "center", marginTop: space.xs },
});
