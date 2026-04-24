import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { Button, Card, Text, tokens } from "../../src/ui/index";

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
      setError(e instanceof Error ? e.message : "could not save");
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text variant="title">What should we call you?</Text>
        <Text tone="secondary" style={styles.tagline}>
          This is how you'll show up to people you share lists with. You can change it later.
        </Text>
      </View>

      <Card style={styles.card} elevated>
        <Text variant="label" tone="secondary">
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
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    justifyContent: "center",
    gap: tokens.space.xxl,
  },
  header: { gap: tokens.space.md, alignItems: "center" },
  tagline: { textAlign: "center", maxWidth: 420 },
  card: { gap: tokens.space.md, maxWidth: 420, width: "100%", alignSelf: "center" },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
  },
  error: { textAlign: "center" },
});
