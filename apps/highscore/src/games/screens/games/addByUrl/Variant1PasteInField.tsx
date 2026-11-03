// Variant 1 — "Paste inside the field".
//
// A real text input on every platform (tap → keyboard, like any input), with a
// labelled PASTE pill inside it. Paste reads the clipboard: a link is added in
// the same tap; other text lands in the box with a hint; an empty clipboard
// says so. Once there's text the pill becomes a clear ×. Nothing is hidden
// behind a mode switch.

import { haptics } from "@workshop/ui";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button, PixelIcon, Text, tokens } from "../../../../theme";
import { readClipboardLink } from "./clipboardLink";
import { footerStyles, INPUT_PLACEHOLDER } from "./footerStyles";
import type { AddByUrl } from "./useAddByUrl";

export function Variant1PasteInField({ add }: { add: AddByUrl }) {
  const inputRef = useRef<TextInput>(null);
  const [hint, setHint] = useState<string | null>(null);

  const paste = async () => {
    const read = await readClipboardLink();
    if (read.kind === "empty") {
      setHint("Nothing copied yet. Copy a game's link, or type it here.");
      inputRef.current?.focus();
      return;
    }
    haptics.light();
    add.setDraft(read.text);
    if (read.kind === "link") {
      setHint(null);
      add.submit(read.text);
    } else {
      setHint("That doesn't look like a link. Edit it, or paste a web address.");
      inputRef.current?.focus();
    }
  };

  return (
    <>
      <Text variant="caption" tone="muted" style={footerStyles.label}>
        Or add by link
      </Text>
      <View style={footerStyles.row}>
        <View style={[footerStyles.urlBox, styles.field]}>
          <TextInput
            ref={inputRef}
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
            keyboardType="url"
            maxLength={2000}
            onSubmitEditing={() => add.submit()}
            style={[footerStyles.input, styles.input]}
          />
          {add.draft ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear"
              hitSlop={8}
              onPress={() => {
                add.setDraft("");
                setHint(null);
              }}
              testID="add-game-url-clear"
              style={styles.pill}
            >
              <PixelIcon name="close" size={16} color={tokens.text.secondary} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Paste a link"
              hitSlop={8}
              onPress={() => void paste()}
              testID="add-game-url-paste"
              style={({ pressed }) => [
                styles.pill,
                styles.pastePill,
                pressed && styles.pillPressed,
              ]}
            >
              <Text variant="overline" tone="link">
                PASTE
              </Text>
            </Pressable>
          )}
        </View>
        <Button
          label="Add"
          onPress={() => add.submit()}
          disabled={!add.canSubmit}
          loading={add.pending}
          testID="add-game-submit"
        />
      </View>
      <Text variant="caption" tone={hint ? "secondary" : "muted"} style={footerStyles.hint}>
        {hint ?? "Known dailies snap to their catalog entry."}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", paddingRight: tokens.space.xs },
  input: { flex: 1, minWidth: 0 },
  pill: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    borderRadius: tokens.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pastePill: { borderWidth: tokens.bezel, borderColor: tokens.neon.pink },
  pillPressed: { backgroundColor: tokens.bg.surface },
});
