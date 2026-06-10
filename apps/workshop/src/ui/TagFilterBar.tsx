// Horizontal chip bar for filtering a list's items by tag (spec §2.2).
// Multi-select reads as AND within the bar (intersection); the explicit
// "All" chip clears the selection. Counts come from the caller (derived
// from the loaded items), so the bar never fetches.

import { ScrollView, StyleSheet } from "react-native";
import { Chip } from "./Chip";
import { tokens } from "./theme";

export interface TagFilterBarProps {
  /** In-use tags + item counts, in display order. */
  tags: ReadonlyArray<{ tag: string; count: number }>;
  /** Currently selected tags (AND semantics). Empty = "All". */
  selected: ReadonlySet<string>;
  onToggle: (tag: string) => void;
  /** "All" chip pressed — clear every selected tag. */
  onClearAll: () => void;
  testID?: string;
}

export function TagFilterBar({ tags, selected, onToggle, onClearAll, testID }: TagFilterBarProps) {
  if (tags.length === 0) return null;
  const allSelected = selected.size === 0;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      testID={testID ?? "tag-filter-bar"}
      accessibilityLabel="Filter items by tag"
    >
      <Chip
        label="All"
        selected={allSelected}
        onPress={allSelected ? undefined : onClearAll}
        testID="tag-filter-all"
      />
      {tags.map(({ tag, count }) => (
        <Chip
          key={tag}
          label={`${tag} (${count})`}
          selected={selected.has(tag)}
          onPress={() => onToggle(tag)}
          testID={`tag-filter-${tag}`}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.xl,
  },
});
