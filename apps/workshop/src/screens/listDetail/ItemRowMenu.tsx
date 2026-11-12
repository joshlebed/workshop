// Bottom-sheet row menu for unified list-detail rows. Replaces
// `Alert.alert(title, undefined, actions)` since RN-Web silently no-ops on
// 3+ buttons. Used on both platforms.
//
// Action set varies by row state:
//   - ordered      → Move to unordered, Mark complete, Edit, Delete
//   - unordered    → Move to ordered (top/bottom), Mark complete, Edit, Delete
//   - completed    → Mark incomplete, Delete
// Edit is hidden for album_shelf items (their fields are server-derived
// from Spotify and immutable; only position is mutable).

import type { Item } from "@workshop/shared";
import { ActionSheet } from "@workshop/ui";

export interface ItemRowMenuActions {
  section: "ordered" | "unordered" | "completed";
  isAlbumShelf: boolean;
  /** Promote to bottom of ordered. Only meaningful when section !== ordered. */
  onPromote?: () => void;
  /** Promote to top of ordered. Only meaningful when section !== ordered. */
  onPromoteToTop?: () => void;
  /** Move to unordered. Only meaningful when section === ordered. */
  onDemote?: () => void;
  /** Mark as complete. Only meaningful when section !== completed. */
  onComplete?: () => void;
  /** Mark as incomplete (returns to unordered). Only when section === completed. */
  onUncomplete?: () => void;
  /** Open the item detail screen for editing. Hidden for album_shelf. */
  onEdit?: () => void;
  /** Archive (soft-delete) the row, with a confirmation prompt. */
  onDelete: () => void;
}

interface ItemRowMenuProps {
  item: Item | null;
  actions: ItemRowMenuActions | null;
  onClose: () => void;
}

// The chosen action runs from the sheet's `onClosed` (ActionSheet handles
// it), after its Modal has finished dismissing — a confirm presented while
// the Modal was still on screen could be dropped by iOS (0.13).
export function ItemRowMenu({ item, actions, onClose }: ItemRowMenuProps) {
  const visible = item !== null && actions !== null;
  const a = actions;
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={item?.title}
      testID="item-row-menu-sheet"
      cancelTestID="item-row-menu-cancel"
      items={
        a
          ? [
              a.section === "ordered" &&
                a.onDemote && {
                  label: a.isAlbumShelf ? "Move to detected" : "Move to unordered",
                  onPress: a.onDemote,
                  testID: "item-row-menu-demote",
                },
              a.section === "unordered" &&
                a.onPromoteToTop && {
                  label: "Move to ordered (top)",
                  onPress: a.onPromoteToTop,
                  testID: "item-row-menu-promote-top",
                },
              a.section === "unordered" &&
                a.onPromote && {
                  label: "Move to ordered (bottom)",
                  onPress: a.onPromote,
                  testID: "item-row-menu-promote",
                },
              a.section !== "completed" &&
                a.onComplete && {
                  label: "Mark complete",
                  onPress: a.onComplete,
                  testID: "item-row-menu-complete",
                },
              a.section === "completed" &&
                a.onUncomplete && {
                  label: "Mark incomplete",
                  onPress: a.onUncomplete,
                  testID: "item-row-menu-uncomplete",
                },
              a.onEdit && { label: "Edit", onPress: a.onEdit, testID: "item-row-menu-edit" },
              {
                label: "Delete",
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
