// Row ⋯ menu for list-detail rows (both platforms). Vocabulary follows the
// glossary (ux-pass-plan §6): "Move up" / "Move down" / "Move to top" (the
// keyboard and screen-reader path for reordering), "Add to list" for a row in
// the sync inbox, the list's own completion word, and Delete in
// `status.danger`.

import type { Item } from "@workshop/shared";
import { ActionSheet } from "@workshop/ui";
import { useState } from "react";

export interface ItemRowMenuActions {
  /** A sync-inbox row: place it at the top of the list. */
  onAddToList?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveToTop?: () => void;
  /** Complete / reopen, with the label in the list's own word. */
  completion?: { label: string; onPress: () => void };
  onDelete: () => void;
}

interface ItemRowMenuProps {
  item: Item | null;
  actions: ItemRowMenuActions | null;
  onClose: () => void;
}

// The chosen action runs from the sheet's `onClosed` (ActionSheet handles it),
// after its Modal has finished dismissing (0.13).
export function ItemRowMenu({ item, actions, onClose }: ItemRowMenuProps) {
  const visible = item !== null && actions !== null;
  // Keep the last row's title and actions through the exit animation, so the
  // sheet slides away whole instead of emptying first.
  const [shown, setShown] = useState({ item, actions });
  if (visible && (shown.item !== item || shown.actions !== actions)) setShown({ item, actions });
  const a = visible ? actions : shown.actions;
  const title = visible ? item.title : shown.item?.title;
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={title}
      testID="item-row-menu-sheet"
      cancelTestID="item-row-menu-cancel"
      items={
        a
          ? [
              a.onAddToList && {
                label: "Add to list",
                icon: "plus" as const,
                onPress: a.onAddToList,
                testID: "item-row-menu-add-to-list",
              },
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
              a.onMoveToTop && {
                label: "Move to top",
                onPress: a.onMoveToTop,
                testID: "item-row-menu-top",
              },
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
