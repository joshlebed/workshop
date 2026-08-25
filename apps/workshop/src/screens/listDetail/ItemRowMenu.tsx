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
import { Sheet, Text, tokens } from "@workshop/ui";
import { Pressable, StyleSheet, View } from "react-native";

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

export function ItemRowMenu({ item, actions, onClose }: ItemRowMenuProps) {
  const visible = item !== null && actions !== null;

  const run = (fn?: () => void) => () => {
    onClose();
    if (!fn) return;
    // Defer one tick so the sheet's exit animation runs before any
    // follow-up alert / sheet (e.g. delete confirmation).
    setTimeout(fn, 0);
  };

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="item-row-menu-sheet">
      {item && actions ? (
        <>
          <View style={styles.titleRow}>
            <Text variant="heading" numberOfLines={1} style={styles.title}>
              {item.title}
            </Text>
          </View>
          {actions.section === "ordered" && actions.onDemote ? (
            <MenuItem
              label={actions.isAlbumShelf ? "Move to detected" : "Move to unordered"}
              onPress={run(actions.onDemote)}
              testID="item-row-menu-demote"
            />
          ) : null}
          {actions.section === "unordered" && actions.onPromoteToTop ? (
            <MenuItem
              label="Move to ordered (top)"
              onPress={run(actions.onPromoteToTop)}
              testID="item-row-menu-promote-top"
            />
          ) : null}
          {actions.section === "unordered" && actions.onPromote ? (
            <MenuItem
              label="Move to ordered (bottom)"
              onPress={run(actions.onPromote)}
              testID="item-row-menu-promote"
            />
          ) : null}
          {actions.section !== "completed" && actions.onComplete ? (
            <MenuItem
              label="Mark complete"
              onPress={run(actions.onComplete)}
              testID="item-row-menu-complete"
            />
          ) : null}
          {actions.section === "completed" && actions.onUncomplete ? (
            <MenuItem
              label="Mark incomplete"
              onPress={run(actions.onUncomplete)}
              testID="item-row-menu-uncomplete"
            />
          ) : null}
          {actions.onEdit ? (
            <MenuItem label="Edit" onPress={run(actions.onEdit)} testID="item-row-menu-edit" />
          ) : null}
          <MenuItem
            label="Delete"
            tone="danger"
            onPress={run(actions.onDelete)}
            testID="item-row-menu-delete"
          />
          <MenuItem label="Cancel" tone="muted" onPress={onClose} testID="item-row-menu-cancel" />
        </>
      ) : null}
    </Sheet>
  );
}

interface MenuItemProps {
  label: string;
  onPress: () => void;
  tone?: "default" | "danger" | "muted";
  testID?: string;
}

function MenuItem({ label, onPress, tone = "default", testID }: MenuItemProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <Text
        style={[
          styles.itemLabel,
          tone === "danger" && styles.itemDanger,
          tone === "muted" && styles.itemMuted,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: { paddingBottom: tokens.space.sm },
  title: { color: tokens.text.primary },
  item: {
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.md,
  },
  itemPressed: { backgroundColor: tokens.bg.elevated },
  itemLabel: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
  },
  itemDanger: { color: tokens.accent.default, fontWeight: tokens.font.weight.bold },
  itemMuted: { color: tokens.text.muted },
});
