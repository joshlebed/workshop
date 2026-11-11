// Saved views strip (spec §2.3) — named, shared tag-filter presets that sit
// just above the live tag-chip bar on the list detail. Tap a view to apply
// its tags; long-press to delete it (creator/owner only, enforced server-side).
// When the current tag selection isn't already a saved view, a "+ Save view"
// chip opens a small naming sheet so any member can persist the filter for
// everyone.

import type { SavedView } from "@workshop/shared";
import { Button, Chip, Sheet, Text, TextField, tokens } from "@workshop/ui";
import { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, View } from "react-native";

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
  /**
   * Whether the viewer may delete this view. The server only lets the view's
   * creator or the list owner delete it, so nobody else is offered the action
   * (it used to end in a 403).
   */
  canDelete: (view: SavedView) => boolean;
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
  canDelete,
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
  // contextual trailing chip: "Save view" (plus icon) when the filter is
  // unsaved, "Delete view" (close icon, danger outline) once it matches one.
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
              onLongPress={canDelete(view) ? () => onDelete(view) : undefined}
              delayLongPress={450}
              accessibilityHint={
                canDelete(view)
                  ? "Applies this saved filter. Long press to delete it."
                  : "Applies this saved filter."
              }
              testID={`saved-view-${viewSlug(view.name)}`}
            />
          );
        })}
        {canSave ? (
          <Chip
            label="Save view"
            icon="plus"
            disabled={busy}
            onPress={() => setSaveOpen(true)}
            testID="saved-view-save"
          />
        ) : activeView && canDelete(activeView) ? (
          <Chip
            label="Delete view"
            icon="close"
            tone="danger"
            disabled={busy}
            onPress={() => onDelete(activeView)}
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
        <TextField
          testID="saved-view-name-input"
          value={draft}
          onChangeText={setDraft}
          placeholder="View name"
          accessibilityLabel="View name"
          maxLength={60}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
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
  sheetHeader: { gap: tokens.space.xxs },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
});
