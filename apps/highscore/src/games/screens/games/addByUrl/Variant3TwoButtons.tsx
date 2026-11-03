// Variant 3 — "Two explicit actions".
//
// No fake input. Two buttons say exactly what they do: PASTE A LINK adds the
// copied link in one tap; TYPE A LINK reveals a focused input with Add and a
// Cancel back to the buttons. If paste finds no link, it drops into the typing
// mode with the clipboard text (if any) already in the box.

import { haptics } from "@workshop/ui";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button, PixelIcon, Text, tokens } from "../../../../theme";
import { readClipboardLink } from "./clipboardLink";
import { footerStyles, INPUT_PLACEHOLDER } from "./footerStyles";
import type { AddByUrl } from "./useAddByUrl";

export function Variant3TwoButtons({ add }: { add: AddByUrl }) {
  const [typing, setTyping] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const paste = async () => {
    setReading(true);
    const read = await readClipboardLink();
    setReading(false);
    if (read.kind === "link") {
      haptics.light();
      add.setDraft(read.text);
      add.submit(read.text);
      return;
    }
    if (read.kind === "text") add.setDraft(read.text);
    setHint(
      read.kind === "text"
        ? "That doesn't look like a link. Edit it, or paste a web address."
        : "Nothing copied yet. Type the game's link instead.",
    );
    setTyping(true);
  };

  const cancel = () => {
    setTyping(false);
    setHint(null);
    add.setDraft("");
  };

  return (
    <>
      <Text variant="caption" tone="muted" style={footerStyles.label}>
        Or add by link
      </Text>
      {typing ? (
        <>
          <View style={footerStyles.row}>
            <TextInput
              testID="add-game-url-input"
              value={add.draft}
              onChangeText={(t) => {
                add.setDraft(t);
                if (hint) setHint(null);
              }}
              placeholder={INPUT_PLACEHOLDER}
              placeholderTextColor={tokens.text.secondary}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={Platform.OS !== "web"}
              keyboardType="url"
              maxLength={2000}
              onSubmitEditing={() => add.submit()}
              style={[footerStyles.urlBox, footerStyles.input]}
            />
            <Button
              label="Add"
              onPress={() => add.submit()}
              disabled={!add.canSubmit}
              loading={add.pending}
              testID="add-game-submit"
            />
          </View>
          <View style={styles.hintRow}>
            <Text variant="caption" tone={hint ? "secondary" : "muted"} style={styles.hintText}>
              {hint ?? "Known dailies snap to their catalog entry."}
            </Text>
            <Pressable
              onPress={cancel}
              hitSlop={8}
              accessibilityRole="button"
              testID="add-game-url-cancel"
            >
              <Text variant="caption" tone="link">
                Cancel
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={footerStyles.row}>
          <Button
            label="Paste a link"
            leftIcon={<PixelIcon name="link" size={16} color={tokens.neon.pink} />}
            onPress={() => void paste()}
            loading={reading || add.pending}
            style={styles.half}
            testID="add-game-url-paste"
          />
          <Button
            label="Type a link"
            variant="secondary"
            onPress={() => setTyping(true)}
            disabled={add.pending}
            style={styles.half}
            testID="add-game-url-type"
          />
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  half: { flex: 1 },
  hintRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  hintText: { flex: 1, minWidth: 0 },
});
