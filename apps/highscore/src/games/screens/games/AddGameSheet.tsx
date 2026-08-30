// Add-game sheet — the + button's target on the Games home. Two ways in: pick
// a game a friend already plays (discovery suggestions, G3) or paste any URL
// (the skip / bootstrap path — spec §3.3: known dailies collapse onto their
// catalog row, unknown URLs get a link-preview title + favicon, falling back
// to hostname + Google favicon). Home itself stays purely your chosen games;
// discovery only ever surfaces here and on the empty state.

import type { DiscoveryGame } from "@workshop/shared/games";
import { Sheet } from "@workshop/ui";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { HsText, hsBezel, hsColor, hsSheet, hsSpace, PixelButton } from "../../../theme";
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
    <Sheet
      visible={visible}
      onRequestClose={onClose}
      contentStyle={hsSheet}
      testID="add-game-sheet"
    >
      <View style={styles.header}>
        <HsText variant="pixelHeading">Add a game</HsText>
        <HsText variant="caption" tone="secondary">
          {hasSuggestions
            ? "Games your friends play, most popular first — add one, or paste any game's URL."
            : "Paste the game's URL — known dailies are recognized automatically."}
        </HsText>
      </View>

      {discoveryLoading ? (
        <View style={styles.suggestionsLoading}>
          <ActivityIndicator color={hsColor.primary} />
        </View>
      ) : hasSuggestions ? (
        <View style={styles.suggestions}>
          <HsText variant="caption" tone="secondary" style={styles.sectionLabel}>
            Friends play
          </HsText>
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
        <HsText variant="caption" tone="secondary" style={styles.orLabel}>
          Or add by URL
        </HsText>
      ) : null}

      <TextInput
        testID="add-game-url-input"
        value={draft}
        onChangeText={setDraft}
        placeholder="https://example.com/daily"
        placeholderTextColor={hsColor.textSecondary}
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
        <PixelButton label="Cancel" variant="ghost" onPress={onClose} disabled={pending} />
        <PixelButton
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
  suggestionsLoading: { paddingVertical: hsSpace.lg, alignItems: "center" },
  suggestions: { gap: hsSpace.sm },
  suggestionsScroll: { maxHeight: 240 },
  sectionLabel: { letterSpacing: 1, textTransform: "uppercase" },
  orLabel: { letterSpacing: 1, textTransform: "uppercase", marginTop: hsSpace.xs },
  input: {
    borderWidth: hsBezel,
    borderColor: hsColor.border,
    borderRadius: 0,
    paddingHorizontal: hsSpace.md,
    paddingVertical: 12,
    color: hsColor.textPrimary,
    fontSize: 16,
    backgroundColor: hsColor.bg,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: hsSpace.md,
  },
});
