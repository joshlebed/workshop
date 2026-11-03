// The pinned "add by link" footer on the Add-game screen.
//
// A plain input + Add, and above it a one-tap suggestion that appears only
// when the pasteboard actually holds a URL (checked by type, which iOS allows
// without the paste prompt — the prompt fires on the tap that adds). Re-checks
// when the app comes back to the foreground, i.e. right after copying a link
// in Safari. Dismiss hides it until the clipboard changes to another link.
// Chosen over four alternatives in #544 (paste pill, two buttons, morphing
// button, sheet): it only asks when it can help, and the fallback is an
// honest text field.

import type { Game } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { useEffect, useState } from "react";
import { AppState, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, PixelIcon, Text, tokens } from "../../../../theme";
import { clipboardHasLink, readClipboardLink } from "./clipboardLink";
import { footerStyles, INPUT_PLACEHOLDER } from "./footerStyles";
import { useAddByUrl } from "./useAddByUrl";

export function AddByUrlFooter({ onAdded }: { onAdded: (game: Game) => void | Promise<void> }) {
  const insets = useSafeAreaInsets();
  const add = useAddByUrl(onAdded);
  const [hasLink, setHasLink] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const next = await clipboardHasLink();
      if (!alive) return;
      setHasLink((prev) => {
        // A fresh link after a dismissal is a new suggestion.
        if (next && !prev) setDismissed(false);
        return next;
      });
    };
    void check();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const addFromClipboard = async () => {
    const read = await readClipboardLink();
    if (read.kind === "link") {
      haptics.light();
      add.setDraft(read.text);
      add.submit(read.text);
      return;
    }
    // The pasteboard claimed a URL type but the text isn't usable — fall back
    // to the box so the user can see and fix it.
    setHasLink(false);
    if (read.kind === "text") add.setDraft(read.text);
    setHint("Couldn't read a link from your clipboard. Paste or type it below.");
  };

  const showSuggestion = hasLink && !dismissed && !add.pending;

  return (
    <View
      style={[footerStyles.footer, { paddingBottom: Math.max(insets.bottom, tokens.space.md) }]}
      testID="add-game-url-footer"
    >
      <Text variant="caption" tone="muted" style={footerStyles.label}>
        Or add by link
      </Text>
      {showSuggestion ? (
        <View style={styles.suggestion} testID="add-game-clipboard-suggestion">
          <PixelIcon name="link" size={16} color={tokens.neon.pink} />
          <Text variant="label" style={styles.suggestionText} numberOfLines={1}>
            You copied a link
          </Text>
          <Button
            label="Dismiss"
            variant="ghost"
            onPress={() => setDismissed(true)}
            testID="add-game-clipboard-dismiss"
          />
          <Button
            label="Add it"
            onPress={() => void addFromClipboard()}
            testID="add-game-clipboard-add"
          />
        </View>
      ) : null}
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
      {hint ? (
        <Text variant="caption" tone="secondary" style={footerStyles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    paddingLeft: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.surface,
  },
  suggestionText: { flex: 1, minWidth: 0, color: tokens.text.primary },
});
