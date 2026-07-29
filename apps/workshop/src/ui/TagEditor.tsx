import { useState } from "react";
import { StyleSheet, TextInput, View, type ViewStyle } from "react-native";
import { Chip } from "./Chip";
import { tokens } from "./theme";

/** Mirror of the server's tag normalization (trim, lowercase, collapse). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Matches the backend's `tagListSchema` cap so the UI can't build a 400. */
export const MAX_TAGS_PER_ITEM = 20;

export interface TagEditorProps {
  /** The item's current tags (server-canonical: lowercase, sorted). */
  tags: string[];
  /** Every in-use tag on the parent list — drives the suggested chips. */
  listTags: string[];
  /** A write is in flight; chips disable to prevent races. */
  pending?: boolean;
  onChange: (next: string[]) => void;
  /**
   * testID prefix. Chips render `<prefix>-<tag>` /
   * `<prefix>-suggest-<tag>`, the input `<prefix>-input`.
   */
  testIDPrefix?: string;
  style?: ViewStyle;
}

/**
 * Suggested-chip tag picker (spec §2.1): the current tags render selected
 * (tap to remove), the rest of the list's in-use tags render as unselected
 * suggestions (tap to add), and a quiet inline input creates a new tag on
 * submit. Never a bare free-text field — the list's existing vocabulary is
 * always one tap away. Shared by the item-detail screen (writes through on
 * every change) and the add-item form (holds a draft set until submit), so
 * it stays presentational: no queries, no mutations.
 */
export function TagEditor({
  tags,
  listTags,
  pending = false,
  onChange,
  testIDPrefix = "item-tag",
  style,
}: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const suggestions = listTags.filter((t) => !tags.includes(t));
  const full = tags.length >= MAX_TAGS_PER_ITEM;

  const addDraft = () => {
    const tag = normalizeTag(draft);
    if (!tag || tag.length > 40) return;
    setDraft("");
    if (tags.includes(tag) || full) return;
    onChange([...tags, tag]);
  };

  return (
    <View style={[styles.chips, style]}>
      {tags.map((tag) => (
        <Chip
          key={tag}
          label={tag}
          selected
          disabled={pending}
          onPress={() => onChange(tags.filter((t) => t !== tag))}
          testID={`${testIDPrefix}-${tag}`}
        />
      ))}
      {suggestions.map((tag) => (
        <Chip
          key={tag}
          label={tag}
          disabled={pending || full}
          onPress={() => onChange([...tags, tag])}
          testID={`${testIDPrefix}-suggest-${tag}`}
        />
      ))}
      {full ? null : (
        <TextInput
          testID={`${testIDPrefix}-input`}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={addDraft}
          onBlur={addDraft}
          placeholder={tags.length === 0 && suggestions.length === 0 ? "Add a tag" : "Add tag"}
          placeholderTextColor={tokens.text.muted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={40}
          // Keep the keyboard up for rapid multi-tag entry on native; web
          // ignores this and keeps focus anyway.
          blurOnSubmit={false}
          style={styles.input}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  input: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    paddingVertical: 6,
    paddingHorizontal: tokens.space.sm,
    minWidth: 96,
  },
});
