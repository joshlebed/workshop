// Row ⋯ menu for list-detail rows (both platforms). Vocabulary follows the
// glossary (ux-pass-plan §6): Ranked / "Rank at top" / "Rank at bottom" /
// "Remove from ranking", the list's own completion word, and Delete in
// `status.danger`. "Move up" / "Move down" are the keyboard and screen-reader
// path for reordering (2.8). Edit is hidden for album-shelf items (their
// fields are server-derived from Spotify).

import type { Item } from "@workshop/shared";
import { ActionSheet } from "@workshop/ui";

export interface ItemRowMenuActions {
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRankTop?: () => void;
  onRankBottom?: () => void;
  onUnrank?: () => void;
  /** Complete / reopen, with the label in the list's own word. */
  completion?: { label: string; onPress: () => void };
  onEdit?: () => void;
  onDelete: () => void;
}

interface ItemRowMenuProps {
  item: Item | null;
  actions: ItemRowMenuActions | null;
  onClose: () => void;
}

// The chosen action runs from the sheet's `onClosed` (ActionSheet handles it),
// after its Modal has finished dismissing (0.13).
export function ItemRowMenu({ item, actions: a, onClose }: ItemRowMenuProps) {
  return (
    <ActionSheet
      visible={item !== null && a !== null}
      onClose={onClose}
      title={item?.title}
      testID="item-row-menu-sheet"
      cancelTestID="item-row-menu-cancel"
      items={
        a
          ? [
              a.completion && {
                label: a.completion.label,
                icon: "check" as const,
                onPress: a.completion.onPress,
                testID: "item-row-menu-complete",
              },
              a.onMoveUp && { label: "Move up", onPress: a.onMoveUp, testID: "item-row-menu-up" },
              a.onMoveDown && {
                label: "Move down",
                onPress: a.onMoveDown,
                testID: "item-row-menu-down",
              },
              a.onRankTop && {
                label: "Rank at top",
                onPress: a.onRankTop,
                testID: "item-row-menu-rank-top",
              },
              a.onRankBottom && {
                label: "Rank at bottom",
                onPress: a.onRankBottom,
                testID: "item-row-menu-rank-bottom",
              },
              a.onUnrank && {
                label: "Remove from ranking",
                onPress: a.onUnrank,
                testID: "item-row-menu-unrank",
              },
              a.onEdit && { label: "Edit", onPress: a.onEdit, testID: "item-row-menu-edit" },
              {
                label: "Delete",
                icon: "trash" as const,
                tone: "danger" as const,
                onPress: a.onDelete,
                testID: "item-row-menu-delete",
              },
            ]
          : []
      }
    />
  );
}
