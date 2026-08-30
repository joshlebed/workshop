// Reaction picker (G2c) — a bottom sheet with a quick-emoji bar plus a "more"
// affordance that drops to a text field, letting the OS emoji keyboard (iOS) /
// system picker (web) supply anything outside the quick set. No emoji-picker
// dependency, so nothing native is added. If the viewer already reacted, their
// current emoji is highlighted and a Remove row is offered.

import { isReactionEmoji, REACTION_QUICK_EMOJIS } from "@workshop/shared/games";
import { Sheet } from "@workshop/ui";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HsButton, HsText, hs } from "../../theme";

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
    <Sheet
      visible={visible}
      onRequestClose={onClose}
      testID="reaction-picker-sheet"
      contentStyle={styles.sheetContent}
    >
      <View style={styles.header}>
        <HsText variant="heading" numberOfLines={1}>
          {targetName ? `React to ${targetName}'s score` : "React to this score"}
        </HsText>
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
            placeholderTextColor={hs.color.textSecondary}
            autoFocus
            maxLength={32}
            style={styles.moreInput}
            testID="reaction-more-input"
          />
          <HsButton
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
          <HsText variant="caption" tone="link" style={styles.moreLinkText}>
            More…
          </HsText>
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
  // Sheets are surface1 with the standard 2px bezel on the top edge — sharp
  // corners, no rounding.
  sheetContent: {
    backgroundColor: hs.color.surface1,
    borderTopWidth: 2,
    borderColor: hs.color.border,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  header: { gap: 4, marginBottom: hs.space.md },
  quickBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: hs.space.sm,
  },
  quickEmoji: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: hs.radius.hard,
    borderWidth: 1,
    borderColor: hs.color.border,
    backgroundColor: hs.color.surface2,
  },
  // The viewer's current reaction is a selection → pink edge.
  quickEmojiActive: {
    borderColor: hs.color.primary,
    backgroundColor: hs.color.surface3,
  },
  quickEmojiHover: { backgroundColor: hs.color.surface3 },
  quickEmojiGlyph: { fontSize: 26, lineHeight: 32 },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hs.space.sm,
    marginTop: hs.space.md,
  },
  moreInput: {
    borderWidth: hs.bezel,
    borderColor: hs.color.border,
    borderRadius: hs.radius.hard,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: hs.space.md,
    color: hs.color.textPrimary,
    fontSize: hs.font.size.lg,
    backgroundColor: hs.color.surface2,
  },
  moreLink: {
    alignSelf: "flex-start",
    marginTop: hs.space.sm,
    paddingVertical: hs.space.xs,
    paddingHorizontal: hs.space.xs,
    marginHorizontal: -hs.space.xs,
    borderRadius: hs.radius.hard,
  },
  moreLinkHover: { backgroundColor: hs.color.surface2 },
  moreLinkText: { textDecorationLine: "underline" },
  removeRow: {
    marginTop: hs.space.md,
    paddingVertical: hs.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: hs.radius.hard,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: hs.color.border,
  },
  removePressed: { backgroundColor: hs.color.surface2 },
  removeLabel: {
    color: hs.color.danger,
    fontSize: hs.font.size.md,
    fontWeight: hs.font.weight.semibold,
  },
});
