// Variant 4 — "One button that changes".
//
// A real input (tap → keyboard) and a single action button whose label tracks
// the state: PASTE while the box is empty, ADD once there is text. Paste reads
// the clipboard and, when it's a link, adds it in the same tap; anything else
// drops into the box with a hint. One row, two things, no extra link text.

import { haptics } from "@workshop/ui";
import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { Button, Text, tokens } from "../../../../theme";
import { readClipboardLink } from "./clipboardLink";
import { footerStyles, INPUT_PLACEHOLDER } from "./footerStyles";
import type { AddByUrl } from "./useAddByUrl";

export function Variant4MorphButton({ add }: { add: AddByUrl }) {
  const inputRef = useRef<TextInput>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const empty = add.draft.trim().length === 0;

  const paste = async () => {
    setReading(true);
    const read = await readClipboardLink();
    setReading(false);
    if (read.kind === "empty") {
      setHint("Nothing copied yet. Tap the box to type a link.");
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
          style={[footerStyles.urlBox, footerStyles.input]}
        />
        {empty ? (
          <Button
            label="Paste"
            onPress={() => void paste()}
            loading={reading || add.pending}
            testID="add-game-url-paste"
          />
        ) : (
          <Button
            label="Add"
            onPress={() => add.submit()}
            disabled={!add.canSubmit}
            loading={add.pending}
            testID="add-game-submit"
          />
        )}
      </View>
      <Text variant="caption" tone={hint ? "secondary" : "muted"} style={footerStyles.hint}>
        {hint ?? "Paste adds a copied link right away."}
      </Text>
    </>
  );
}
