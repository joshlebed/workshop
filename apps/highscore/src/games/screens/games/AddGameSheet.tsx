// Add-game sheet — the + button's target on the Games home. Two ways in: pick
// a game a friend already plays (discovery suggestions, G3) or paste any URL
// (the skip / bootstrap path — spec §3.3: known dailies collapse onto their
// catalog row, unknown URLs get a link-preview title + favicon, falling back
// to hostname + Google favicon). Home itself stays purely your chosen games;
// discovery only ever surfaces here and on the empty state.

import type { DiscoveryGame } from "@workshop/shared/games";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Button, Sheet, Text, tokens } from "../../../theme";
import { FriendGameSuggestions } from "./FriendGameSuggestions";

interface AddGameSheetProps {
  visible: boolean;
  /** URL-field add in flight (closes the sheet on success). */
  pending: boolean;
  onSubmit: (url: string) => void;
  onClose: () => void;
  /** Friends' games I haven't added — shown above the URL field. */
  discovery: DiscoveryGame[];
  discoveryLoading: boolean;
  /** One-tap add of a suggestion; keeps the sheet open for more. */
  onAddDiscovery: (game: DiscoveryGame) => void;
  addingGameIds: string[];
  addedGameIds: string[];
}

export function AddGameSheet({
  visible,
  pending,
  onSubmit,
  onClose,
  discovery,
  discoveryLoading,
  onAddDiscovery,
  addingGameIds,
  addedGameIds,
}: AddGameSheetProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (visible) setDraft("");
  }, [visible]);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !pending;
  const submit = () => {
    if (canSubmit) onSubmit(trimmed);
  };

  const hasSuggestions = discovery.length > 0;

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="add-game-sheet">
      <View style={styles.header}>
        <Text variant="heading">Add a game</Text>
        <Text variant="caption" tone="muted">
          {hasSuggestions
            ? "Games your friends play, most popular first — add one, or paste any game's URL."
            : "Paste the game's URL — known dailies are recognized automatically."}
        </Text>
      </View>

      {discoveryLoading ? (
        <View style={styles.suggestionsLoading}>
          <ActivityIndicator color={tokens.neon.pink} />
        </View>
      ) : hasSuggestions ? (
        <View style={styles.suggestions}>
          <Text variant="caption" tone="muted" style={styles.sectionLabel}>
            Friends play
          </Text>
          <ScrollView
            style={styles.suggestionsScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FriendGameSuggestions
              games={discovery}
              addingGameIds={addingGameIds}
              addedGameIds={addedGameIds}
              onAdd={onAddDiscovery}
              testIDPrefix="add-game-suggestion"
            />
          </ScrollView>
        </View>
      ) : null}

      {hasSuggestions ? (
        <Text variant="caption" tone="muted" style={styles.orLabel}>
          Or add by URL
        </Text>
      ) : null}

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
        // Don't steal focus (and pop the keyboard) when suggestions are the
        // primary affordance — the user taps the field when they want it.
        autoFocus={!hasSuggestions}
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
  suggestionsLoading: { paddingVertical: tokens.space.lg, alignItems: "center" },
  suggestions: { gap: tokens.space.sm },
  suggestionsScroll: { maxHeight: 240 },
  sectionLabel: { letterSpacing: 0.4, textTransform: "uppercase" },
  orLabel: { letterSpacing: 0.4, textTransform: "uppercase", marginTop: tokens.space.xs },
  input: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: 0,
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
