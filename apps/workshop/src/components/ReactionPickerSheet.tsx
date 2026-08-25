// Reaction picker (G2c) — a bottom sheet with a quick-emoji bar plus a "more"
// affordance that drops to a text field, letting the OS emoji keyboard (iOS) /
// system picker (web) supply anything outside the quick set. No emoji-picker
// dependency, so nothing native is added. If the viewer already reacted, their
// current emoji is highlighted and a Remove row is offered.

import { isReactionEmoji, REACTION_QUICK_EMOJIS } from "@workshop/shared/games";
import { Button, Sheet, Text, tokens } from "@workshop/ui";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

export interface ReactionPickerSheetProps {
  visible: boolean;
  /** Whose score is being reacted to — names the sheet ("React to Alex's score"). */
  targetName: string | null;
  /** The viewer's current reaction on this score, if any. */
  current: string | null;
  onPick: (emoji: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function ReactionPickerSheet({
  visible,
  targetName,
  current,
  onPick,
  onRemove,
  onClose,
}: ReactionPickerSheetProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [draft, setDraft] = useState("");

  // Reset the "more" field whenever the sheet (re)opens.
  useEffect(() => {
    if (visible) {
      setMoreOpen(false);
      setDraft("");
    }
  }, [visible]);

  const draftValid = isReactionEmoji(draft);

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="reaction-picker-sheet">
      <View style={styles.header}>
        <Text variant="heading" numberOfLines={1}>
          {targetName ? `React to ${targetName}'s score` : "React to this score"}
        </Text>
      </View>

      <View style={styles.quickBar}>
        {REACTION_QUICK_EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`React ${emoji}`}
            onPress={() => onPick(emoji)}
            testID={`reaction-quick-${emoji}`}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.quickEmoji,
              current === emoji && styles.quickEmojiActive,
              (pressed || hovered) && styles.quickEmojiHover,
            ]}
          >
            <Text style={styles.quickEmojiGlyph}>{emoji}</Text>
          </Pressable>
        ))}
      </View>

      {moreOpen ? (
        <View style={styles.moreRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type or paste an emoji"
            placeholderTextColor={tokens.text.muted}
            autoFocus
            maxLength={32}
            style={styles.moreInput}
            testID="reaction-more-input"
          />
          <Button
            label="React"
            size="md"
            disabled={!draftValid}
            onPress={() => draftValid && onPick(draft.trim())}
            testID="reaction-more-submit"
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More emoji"
          onPress={() => setMoreOpen(true)}
          testID="reaction-more"
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            styles.moreLink,
            (pressed || hovered) && styles.moreLinkHover,
          ]}
        >
          <Text variant="caption" tone="secondary" style={styles.moreLinkText}>
            More…
          </Text>
        </Pressable>
      )}

      {current ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove your reaction"
          onPress={onRemove}
          testID="reaction-remove"
          style={({ pressed }) => [styles.removeRow, pressed && styles.removePressed]}
        >
          <Text style={styles.removeLabel}>Remove {current}</Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4, marginBottom: tokens.space.md },
  quickBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm,
  },
  quickEmoji: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.elevated,
  },
  quickEmojiActive: {
    borderColor: tokens.accent.default,
    backgroundColor: tokens.accent.muted,
  },
  quickEmojiHover: { backgroundColor: tokens.bg.surface },
  quickEmojiGlyph: { fontSize: 26, lineHeight: 32 },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    marginTop: tokens.space.md,
  },
  moreInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    backgroundColor: tokens.bg.canvas,
  },
  moreLink: {
    alignSelf: "flex-start",
    marginTop: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  moreLinkHover: { backgroundColor: tokens.bg.elevated },
  moreLinkText: { textDecorationLine: "underline" },
  removeRow: {
    marginTop: tokens.space.md,
    paddingVertical: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
  },
  removePressed: { backgroundColor: tokens.bg.elevated },
  removeLabel: {
    color: tokens.status.danger,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
  },
});
