// Reaction picker (G2c) — a bottom sheet with a quick-emoji bar plus a "more"
// affordance that drops to a text field, letting the OS emoji keyboard (iOS) /
// system picker (web) supply anything outside the quick set. No emoji-picker
// dependency, so nothing native is added. If the viewer already reacted, their
// current emoji is highlighted and a Remove row is offered.

import { isReactionEmoji, REACTION_QUICK_EMOJIS } from "@workshop/shared/games";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button, bezel, colors, font, radius, Sheet, space, Text } from "../../theme";

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
            placeholderTextColor={colors.textSecondary}
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
  header: { gap: 4, marginBottom: space.md },
  quickBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.sm,
  },
  quickEmoji: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.none,
    borderWidth: bezel,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  quickEmojiActive: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}26`,
  },
  quickEmojiHover: { backgroundColor: colors.surface3 },
  quickEmojiGlyph: { fontSize: 26, lineHeight: 32 },
  moreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginTop: space.md,
  },
  moreInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: bezel,
    borderColor: colors.border,
    borderRadius: radius.soft,
    paddingHorizontal: space.md,
    color: colors.textPrimary,
    fontSize: font.size.lg,
    backgroundColor: colors.bg,
  },
  moreLink: {
    alignSelf: "flex-start",
    marginTop: space.sm,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    marginHorizontal: -space.xs,
    borderRadius: radius.none,
  },
  moreLinkHover: { backgroundColor: colors.surface2 },
  moreLinkText: { textDecorationLine: "underline" },
  removeRow: {
    marginTop: space.md,
    paddingVertical: space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.none,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  removePressed: { backgroundColor: colors.surface2 },
  removeLabel: {
    color: colors.danger,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
});
