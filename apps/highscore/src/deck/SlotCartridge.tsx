// The empty slot at the end of the deck. Swipe past your last game and you
// land here — there is no add-game sheet and no floating button, because the
// deck already has a place where a new cartridge goes.
//
// Same surface, three states:
//   • deck has games      → paste a URL, or take one your friends play
//   • deck empty, no friends → the friends-first pitch (an invite link)
//   • deck empty, friends    → their games as one-tap picks

import type { DiscoveryGame } from "@workshop/shared/games";
import { useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { FriendGameSuggestions } from "../games/screens/games/FriendGameSuggestions";
import { Button, GutterRow, Text, tokens } from "../theme";

interface SlotCartridgeProps {
  width: number;
  /** No games at all — the slot is the whole deck. */
  deckEmpty: boolean;
  hasFriends: boolean;
  friendsLoading: boolean;
  discovery: DiscoveryGame[];
  discoveryLoading: boolean;
  addingGameIds: string[];
  addedGameIds: string[];
  addPending: boolean;
  onAddUrl: (url: string) => void;
  onAddDiscovery: (game: DiscoveryGame) => void;
  invitePending: boolean;
  inviteUrl: string | null;
  onInvite: () => void;
  onCopyInvite: () => void;
}

export function SlotCartridge({
  width,
  deckEmpty,
  hasFriends,
  friendsLoading,
  discovery,
  discoveryLoading,
  addingGameIds,
  addedGameIds,
  addPending,
  onAddUrl,
  onAddDiscovery,
  invitePending,
  inviteUrl,
  onInvite,
  onCopyInvite,
}: SlotCartridgeProps) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && !addPending;
  const suggestions = discovery;
  const pitchFriends = deckEmpty && !hasFriends && !friendsLoading;

  return (
    <View style={[styles.root, { width }]} testID="deck-slot">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <GutterRow rule marker={<View style={styles.slotMark} />} style={styles.header}>
          <Text variant="title" style={styles.title}>
            {deckEmpty ? "Insert cartridge" : "Add a game"}
          </Text>
          <Text variant="caption" tone="muted" style={styles.sub}>
            {pitchFriends
              ? "HighScore is friends comparing the same daily puzzle. Bring one along first."
              : "Paste a daily game's link. Known games are recognised automatically."}
          </Text>
        </GutterRow>

        {pitchFriends ? (
          <GutterRow rule marker={null} style={styles.section}>
            <View style={styles.stack}>
              <Button
                label="Invite a friend"
                onPress={onInvite}
                loading={invitePending}
                testID="games-empty-add-friends"
              />
              {inviteUrl ? (
                <View style={styles.inviteRow}>
                  <View style={styles.inviteField}>
                    <Text
                      variant="caption"
                      tone="secondary"
                      numberOfLines={1}
                      testID="games-empty-invite-url"
                    >
                      {inviteUrl}
                    </Text>
                  </View>
                  <Button
                    label="Copy"
                    variant="secondary"
                    onPress={onCopyInvite}
                    testID="games-empty-invite-copy"
                  />
                </View>
              ) : null}
            </View>
          </GutterRow>
        ) : null}

        <GutterRow rule marker={null} style={styles.section}>
          <View style={styles.stack}>
            <TextInput
              testID="add-game-url-input"
              value={draft}
              onChangeText={setDraft}
              placeholder="https://example.com/daily"
              placeholderTextColor={tokens.text.secondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={2000}
              onSubmitEditing={() => canSubmit && onAddUrl(trimmed)}
              style={styles.input}
            />
            <Button
              label="Add game"
              onPress={() => canSubmit && onAddUrl(trimmed)}
              disabled={!canSubmit}
              loading={addPending}
              testID="add-game-submit"
            />
          </View>
        </GutterRow>

        {discoveryLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={tokens.neon.pink} />
          </View>
        ) : suggestions.length > 0 ? (
          <GutterRow
            rule
            marker={
              <Text variant="heading" tone="secondary" style={styles.sectionLabel}>
                They play
              </Text>
            }
            style={styles.section}
          >
            <FriendGameSuggestions
              games={suggestions}
              addingGameIds={addingGameIds}
              addedGameIds={addedGameIds}
              onAdd={onAddDiscovery}
              testIDPrefix="games-empty-suggestion"
            />
          </GutterRow>
        ) : deckEmpty && hasFriends ? (
          <Text
            variant="caption"
            tone="muted"
            style={styles.hint}
            testID="games-empty-no-suggestions"
          >
            Your friends haven't added any games yet. Add one by link and they'll see it too.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingBottom: tokens.space.xxl * 2 },
  header: { paddingTop: tokens.space.lg, paddingBottom: tokens.space.lg },
  slotMark: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderStyle: Platform.OS === "web" ? "dashed" : "solid",
  },
  title: { fontSize: 16, lineHeight: 24 },
  sub: { paddingTop: 2 },
  section: { paddingBottom: tokens.space.lg },
  stack: { gap: tokens.space.sm },
  sectionLabel: { fontSize: 10, lineHeight: 16, letterSpacing: 1 },
  input: {
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 12,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.surface,
  },
  loading: { paddingVertical: tokens.space.lg, alignItems: "center" },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  inviteField: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  hint: { paddingHorizontal: tokens.space.lg },
});
