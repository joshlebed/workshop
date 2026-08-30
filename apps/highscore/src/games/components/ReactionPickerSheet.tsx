// Reaction picker (G2c) — a bottom sheet with a quick-emoji bar plus a "more"
// affordance that drops to a text field, letting the OS emoji keyboard (iOS) /
// system picker (web) supply anything outside the quick set. No emoji-picker
// dependency, so nothing native is added. If the viewer already reacted, their
// current emoji is highlighted and a Remove row is offered.

import { isReactionEmoji, REACTION_QUICK_EMOJIS } from "@workshop/shared/games";
import { Sheet } from "@workshop/ui";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { HsText, hsBezel, hsColor, hsSheet, hsSpace, PixelButton } from "../../theme";

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
      contentStyle={hsSheet}
      testID="reaction-picker-sheet"
    >
      <View style={styles.header}>
        <HsText variant="pixelHeading" numberOfLines={1}>
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
            <HsText style={styles.quickEmojiGlyph}>{emoji}</HsText>
          </Pressable>
        ))}
      </View>

      {moreOpen ? (
        <View style={styles.moreRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Type or paste an emoji"
            placeholderTextColor={hsColor.textSecondary}
            autoFocus
            maxLength={32}
            style={styles.moreInput}
            testID="reaction-more-input"
          />
          <PixelButton
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
          <HsText variant="caption" tone="secondary" style={styles.moreLinkText}>
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
          <HsText style={styles.removeLabel}>Remove {current}</HsText>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4, marginBottom: hsSpace.md },
  quickBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: hsSpace.sm,
  },
  quickEmoji: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
    borderWidth: 1,
    borderColor: hsColor.border,
    backgroundColor: hsColor.surface2,
  },
  // Current selection → pink bezel (selection is glow-eligible but a picker
  // grid full of glows would break "if everything glows, nothing does").
  quickEmojiActive: {
    borderColor: hsColor.primary,
    backgroundColor: `${hsColor.primary}1F`,
  },
  quickEmojiHover: { backgroundColor: hsColor.surface3 },
  quickEmojiGlyph: { fontSize: 26, lineHeight: 32 },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.sm,
    marginTop: hsSpace.md,
  },
  moreInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
    borderRadius: 0,
    paddingHorizontal: hsSpace.md,
    color: hsColor.textPrimary,
    fontSize: 18,
    backgroundColor: hsColor.bg,
  },
  moreLink: {
    alignSelf: "flex-start",
    marginTop: hsSpace.sm,
    paddingVertical: hsSpace.xs,
    paddingHorizontal: hsSpace.xs,
    marginHorizontal: -hsSpace.xs,
    borderRadius: 0,
  },
  moreLinkHover: { backgroundColor: hsColor.surface2 },
  moreLinkText: { textDecorationLine: "underline" },
  removeRow: {
    marginTop: hsSpace.md,
    paddingVertical: hsSpace.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
    borderTopWidth: 1,
    borderTopColor: hsColor.border,
  },
  removePressed: { backgroundColor: hsColor.surface2 },
  removeLabel: {
    color: hsColor.danger,
    fontSize: 16,
    fontWeight: "600",
  },
});
