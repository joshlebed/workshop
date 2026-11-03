// Variant 5 — "Sheet".
//
// The footer is one honest button: ADD BY LINK. It opens a sheet with a focused
// input, pre-filled from the clipboard when the pasteboard holds a URL (read
// only once the user asked for the sheet), a short explanation, and Add /
// Cancel. The sheet owns keyboard avoidance, so the catalog list keeps its
// full height until you actually want to type.

import { haptics } from "@workshop/ui";
import { useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import { Button, PixelIcon, Sheet, Text, tokens } from "../../../../theme";
import { clipboardHasLink, readClipboardLink } from "./clipboardLink";
import { footerStyles, INPUT_PLACEHOLDER } from "./footerStyles";
import { linkHostLabel } from "./urlFooter";
import type { AddByUrl } from "./useAddByUrl";

export function Variant5Sheet({ add }: { add: AddByUrl }) {
  const [open, setOpen] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const openSheet = async () => {
    if (await clipboardHasLink()) {
      const read = await readClipboardLink();
      if (read.kind === "link") {
        add.setDraft(read.text);
        setPrefilled(true);
      }
    }
    setOpen(true);
  };

  const close = () => setOpen(false);
  const reset = () => {
    add.setDraft("");
    setPrefilled(false);
  };

  const paste = async () => {
    const read = await readClipboardLink();
    if (read.kind === "empty") return;
    haptics.light();
    add.setDraft(read.text);
    setPrefilled(read.kind === "link");
  };

  return (
    <>
      <Button
        label="Add by link"
        variant="secondary"
        leftIcon={<PixelIcon name="link" size={16} color={tokens.text.primary} />}
        onPress={() => void openSheet()}
        loading={add.pending}
        testID="add-game-url-open"
      />
      <Sheet visible={open} onRequestClose={close} onClosed={reset} testID="add-game-url-sheet">
        <View style={styles.header}>
          <Text variant="heading">Add a game by link</Text>
          <Text variant="caption" tone="muted">
            {prefilled
              ? `We found ${linkHostLabel(add.draft)} on your clipboard.`
              : "Paste the game's web address. Known dailies snap to their catalog entry."}
          </Text>
        </View>
        <View style={footerStyles.row}>
          <TextInput
            testID="add-game-url-input"
            value={add.draft}
            onChangeText={(t) => {
              add.setDraft(t);
              setPrefilled(false);
            }}
            placeholder={INPUT_PLACEHOLDER}
            placeholderTextColor={tokens.text.secondary}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={Platform.OS !== "web" && !prefilled}
            keyboardType="url"
            maxLength={2000}
            onSubmitEditing={() => add.submit()}
            style={[footerStyles.urlBox, footerStyles.input]}
          />
          {add.draft ? null : (
            <Button
              label="Paste"
              variant="secondary"
              onPress={() => void paste()}
              testID="add-game-url-paste"
            />
          )}
        </View>
        <View style={styles.actions}>
          <Button label="Cancel" variant="ghost" onPress={close} testID="add-game-url-cancel" />
          <Button
            label="Add"
            onPress={() => add.submit()}
            disabled={!add.canSubmit}
            loading={add.pending}
            style={styles.grow}
            testID="add-game-submit"
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: tokens.space.xs, marginBottom: tokens.space.md },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginTop: tokens.space.md,
  },
  grow: { flex: 1 },
});
