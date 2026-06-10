// Add-by-URL sheet — the + button's target on the Games home. v1 keeps this
// to a single URL field (spec §3.3: known games collapse onto their catalog
// row, unknown URLs get a hostname title); friend-game suggestions arrive
// with the G3 onboarding pass.

import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { Button, Sheet, Text, tokens } from "../../ui/index";

interface AddGameSheetProps {
  visible: boolean;
  pending: boolean;
  onSubmit: (url: string) => void;
  onClose: () => void;
}

export function AddGameSheet({ visible, pending, onSubmit, onClose }: AddGameSheetProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (visible) setDraft("");
  }, [visible]);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !pending;
  const submit = () => {
    if (canSubmit) onSubmit(trimmed);
  };

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="add-game-sheet">
      <View style={styles.header}>
        <Text variant="heading">Add a game</Text>
        <Text variant="caption" tone="muted">
          Paste the game's URL — known dailies are recognized automatically.
        </Text>
      </View>
      <TextInput
        testID="add-game-url-input"
        value={draft}
        onChangeText={setDraft}
        placeholder="https://example.com/daily"
        placeholderTextColor={tokens.text.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        maxLength={2000}
        autoFocus
        onSubmitEditing={submit}
        style={styles.input}
      />
      <View style={styles.actions}>
        <Button label="Cancel" variant="ghost" onPress={onClose} disabled={pending} />
        <Button
          label="Add game"
          onPress={submit}
          disabled={!canSubmit}
          loading={pending}
          testID="add-game-submit"
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
});
