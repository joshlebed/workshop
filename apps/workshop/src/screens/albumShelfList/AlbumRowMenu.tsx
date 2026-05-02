// Bottom-sheet row menu for album-shelf rows. Replaces the previous
// `Alert.alert(title, undefined, actions)` call which silently no-ops on
// react-native-web (Alert with 3+ buttons isn't supported). Used on both
// platforms for consistency.

import type { Item } from "@workshop/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { Sheet, Text, tokens } from "../../ui/index";

export interface AlbumRowMenuActions {
  isOrdered: boolean;
  /** Move to the bottom of ordered (detected → ordered, append). */
  onPromote: () => void;
  /** Move to the top of ordered (detected → ordered, prepend). */
  onPromoteToTop: () => void;
  /** Move to detected (ordered → detected). */
  onDemote: () => void;
  /** Permanently remove the row, with a confirmation prompt. */
  onDelete: () => void;
}

interface AlbumRowMenuProps {
  /** The row whose menu is shown, or null to hide. */
  item: Item | null;
  actions: AlbumRowMenuActions | null;
  onClose: () => void;
}

export function AlbumRowMenu({ item, actions, onClose }: AlbumRowMenuProps) {
  const visible = item !== null && actions !== null;

  const run = (fn: () => void) => () => {
    onClose();
    // Defer one tick so the sheet's exit animation runs before the action
    // triggers any follow-up alert / sheet (e.g. delete confirmation).
    setTimeout(fn, 0);
  };

  return (
    <Sheet visible={visible} onRequestClose={onClose} testID="album-row-menu-sheet">
      {item && actions ? (
        <>
          <View style={styles.titleRow}>
            <Text variant="heading" numberOfLines={1} style={styles.title}>
              {item.title}
            </Text>
          </View>
          {actions.isOrdered ? (
            <MenuItem
              label="Move to detected"
              onPress={run(actions.onDemote)}
              testID="album-row-menu-demote"
            />
          ) : (
            <>
              <MenuItem
                label="Move to ordered (top)"
                onPress={run(actions.onPromoteToTop)}
                testID="album-row-menu-promote-top"
              />
              <MenuItem
                label="Move to ordered (bottom)"
                onPress={run(actions.onPromote)}
                testID="album-row-menu-promote"
              />
            </>
          )}
          <MenuItem
            label="Delete album"
            tone="danger"
            onPress={run(actions.onDelete)}
            testID="album-row-menu-delete"
          />
          <MenuItem label="Cancel" tone="muted" onPress={onClose} testID="album-row-menu-cancel" />
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
