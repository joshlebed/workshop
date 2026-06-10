// Saved views strip (spec §2.3) — named, shared tag-filter presets that sit
// just above the live tag-chip bar on the list detail. Tap a view to apply
// its tags; long-press to delete it (creator/owner only, enforced server-side).
// When the current tag selection isn't already a saved view, a "+ Save view"
// chip opens a small naming sheet so any member can persist the filter for
// everyone.

import type { SavedView } from "@workshop/shared";
import { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Button, Chip, Sheet, Text, tokens } from "../../ui/index";

interface SavedViewsBarProps {
  views: SavedView[];
  /** Current live tag selection (OR set) — drives which view reads as active. */
  selectedTags: string[];
  /** Apply a view's tags (the parent toggles off if it's already active). */
  onApply: (view: SavedView) => void;
  /** Persist the current selection as a new named view. */
  onCreate: (name: string) => void;
  /** Remove a view (the parent confirms + mutates). */
  onDelete: (view: SavedView) => void;
  /** True when the selection is non-empty and not already saved. */
  canSave: boolean;
  /** A create/delete is in flight — disable affordances to avoid races. */
  busy?: boolean;
}

/** Two tag selections are the same view when they hold the same set. */
function sameTagSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

/** Suggested view name from the selected tags ("burgers" → "Burgers"). */
function suggestName(tags: string[]): string {
  return tags.map((t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)).join(" + ");
}

/** Stable, lowercase testID slug for a view name. */
function viewSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function SavedViewsBar({
  views,
  selectedTags,
  onApply,
  onCreate,
  onDelete,
  canSave,
  busy = false,
}: SavedViewsBarProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [draft, setDraft] = useState("");

  // Prefill the name with the current selection each time the sheet opens.
  useEffect(() => {
    if (saveOpen) setDraft(suggestName(selectedTags));
  }, [saveOpen, selectedTags]);

  if (views.length === 0 && !canSave) return null;

  const trimmedDraft = draft.trim();
  const submit = () => {
    if (trimmedDraft.length === 0 || busy) return;
    onCreate(trimmedDraft);
    setSaveOpen(false);
  };

  // The view (if any) the current selection exactly reproduces — drives the
  // contextual trailing chip: "＋ Save view" when the filter is unsaved,
  // "✕ Delete view" once it matches a stored one.
  const activeView =
    selectedTags.length > 0
      ? (views.find((v) => sameTagSet(v.config.tags, selectedTags)) ?? null)
      : null;

  const webSubmitProps =
    Platform.OS === "web"
      ? ({
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          },
        } as Record<string, unknown>)
      : {};

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        testID="saved-views-bar"
        accessibilityLabel="Saved views"
      >
        {views.map((view) => {
          const active = sameTagSet(view.config.tags, selectedTags) && selectedTags.length > 0;
          return (
            <Chip
              key={view.id}
              label={view.name}
              selected={active}
              disabled={busy}
              onPress={() => onApply(view)}
              onLongPress={() => onDelete(view)}
              delayLongPress={450}
              accessibilityHint="Applies this saved filter. Long press to delete it."
              testID={`saved-view-${viewSlug(view.name)}`}
            />
          );
        })}
        {canSave ? (
          <Chip
            label="＋ Save view"
            disabled={busy}
            onPress={() => setSaveOpen(true)}
            testID="saved-view-save"
          />
        ) : activeView ? (
          <Chip
            label="✕ Delete view"
            disabled={busy}
            onPress={() => onDelete(activeView)}
            style={styles.deleteChip}
            testID="saved-view-delete"
          />
        ) : null}
      </ScrollView>

      <Sheet visible={saveOpen} onRequestClose={() => setSaveOpen(false)} testID="saved-view-sheet">
        <View style={styles.sheetHeader}>
          <Text variant="heading">Save this view</Text>
          <Text variant="caption" tone="muted">
            {selectedTags.length > 0
              ? `Filtering ${selectedTags.map((t) => `“${t}”`).join(", ")}. Everyone on the list sees it.`
              : "Everyone on the list sees it."}
          </Text>
        </View>
        <TextInput
          testID="saved-view-name-input"
          value={draft}
          onChangeText={setDraft}
          placeholder="View name"
          placeholderTextColor={tokens.text.muted}
          maxLength={60}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
          style={styles.input}
          {...webSubmitProps}
        />
        <View style={styles.actions}>
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => setSaveOpen(false)}
            disabled={busy}
          />
          <Button
            label="Save view"
            onPress={submit}
            disabled={trimmedDraft.length === 0 || busy}
            loading={busy}
            testID="saved-view-save-submit"
          />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.xl,
  },
  deleteChip: { borderColor: tokens.status.danger },
  sheetHeader: { gap: 2 },
  input: {
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
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
