import { type ReactNode, useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { createDeferredAction } from "./deferredAction";
import { Icon, type IconName } from "./Icon";
import { interaction, type PressState, webSpaceKey } from "./interaction";
import { Sheet } from "./Sheet";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface ActionSheetItem {
  label: string;
  icon?: IconName;
  /** `danger` draws in `status.danger` (never the accent). */
  tone?: "default" | "danger";
  onPress: () => void;
  /** Quiet trailing detail on the same row (a link's host). */
  detail?: string;
  disabled?: boolean;
  testID?: string;
}

export interface ActionSheetProps {
  visible: boolean;
  /** Close without a choice (backdrop, Escape, Cancel). */
  onClose: () => void;
  title?: string;
  /** Custom header above the actions (an identity row). Replaces `title`. */
  header?: ReactNode;
  /** Falsy entries are skipped, so callers can write `cond && {...}`. */
  items: (ActionSheetItem | false | null | undefined)[];
  /** Label of the trailing cancel row; `null` hides it. Default "Cancel". */
  cancelLabel?: string | null;
  cancelTestID?: string;
  /** The dialog's name for assistive tech when there is no `title` (a custom `header`). */
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A bottom sheet of actions. The chosen action runs from the Sheet's
 * `onClosed`, after its Modal has finished dismissing, so a confirm, an
 * alert, another sheet or a navigation never presents over a sheet that is
 * still animating out (iOS drops those, 0.13).
 */
export function ActionSheet({
  visible,
  onClose,
  title,
  header,
  items,
  cancelLabel = "Cancel",
  cancelTestID,
  accessibilityLabel,
  testID,
}: ActionSheetProps) {
  const name = accessibilityLabel ?? title ?? "Actions";
  const deferred = useRef(createDeferredAction()).current;
  const actions = items.filter(Boolean) as ActionSheetItem[];
  const iconColumn = actions.some((i) => !!i.icon);

  return (
    <Sheet
      visible={visible}
      onRequestClose={() => {
        deferred.cancel();
        onClose();
      }}
      onClosed={() => deferred.flush()}
      accessibilityLabel={name}
      testID={testID}
      contentStyle={styles.content}
    >
      {header ??
        (title ? (
          <Text variant="heading" numberOfLines={2} style={styles.title}>
            {title}
          </Text>
        ) : null)}
      <View
        accessibilityRole="menu"
        aria-label={name}
        style={styles.list}
        {...((Platform.OS === "web" ? { onKeyDown: menuArrowKeys } : {}) as object)}
      >
        {actions.map((item) => (
          <ActionRow
            key={item.label}
            item={item}
            iconColumn={iconColumn}
            onPress={() => {
              deferred.defer(item.onPress);
              onClose();
            }}
          />
        ))}
        {cancelLabel ? (
          <ActionRow
            item={{ label: cancelLabel, onPress: () => {}, testID: cancelTestID }}
            muted
            onPress={() => {
              deferred.cancel();
              onClose();
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Web: the menu's arrow keys (ARIA menu pattern). Up / Down move between
 * items and wrap, Home / End jump to the ends; Tab still works too.
 */
function menuArrowKeys(e: { key: string; currentTarget: unknown; preventDefault: () => void }) {
  if (typeof document === "undefined") return;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const menu = e.currentTarget as HTMLElement;
  const items = Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
  );
  if (items.length === 0) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? items.length - 1
        : e.key === "ArrowDown"
          ? (at + 1) % items.length
          : (at - 1 + items.length) % items.length;
  items[next]?.focus();
}

function ActionRow({
  item,
  onPress,
  muted = false,
  iconColumn = false,
}: {
  item: ActionSheetItem;
  onPress: () => void;
  muted?: boolean;
  /** Some item has an icon: keep the labels in one column (5, polish). */
  iconColumn?: boolean;
}) {
  const danger = item.tone === "danger";
  const color = danger ? tokens.status.danger : muted ? tokens.text.muted : tokens.text.primary;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={item.label}
      accessibilityState={{ disabled: item.disabled }}
      aria-disabled={item.disabled}
      onPress={item.disabled ? undefined : onPress}
      {...webSpaceKey(item.disabled ? undefined : onPress)}
      testID={item.testID}
      style={({ pressed, hovered }: PressState) => [
        styles.row,
        hovered && !item.disabled ? styles.rowHovered : null,
        pressed && !item.disabled ? styles.rowPressed : null,
        item.disabled ? styles.rowDisabled : null,
      ]}
    >
      {item.icon ? (
        <Icon name={item.icon} size={ICON_SIZE} color={color} />
      ) : iconColumn ? (
        <View style={styles.iconSpacer} />
      ) : null}
      <Text style={[{ color }, danger && styles.labelDanger]}>{item.label}</Text>
      {item.detail ? (
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.detail}>
          {item.detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const ICON_SIZE = 20;

const styles = StyleSheet.create({
  iconSpacer: { width: ICON_SIZE },
  content: { gap: tokens.space.sm, paddingHorizontal: tokens.space.lg },
  title: { paddingHorizontal: tokens.space.sm, paddingBottom: tokens.space.xs },
  list: { gap: tokens.space.xxs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 48,
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.md,
  },
  rowHovered: { backgroundColor: interaction.hover },
  rowPressed: { backgroundColor: interaction.pressed },
  rowDisabled: { opacity: 0.5 },
  labelDanger: { fontWeight: tokens.font.weight.semibold },
  detail: { flex: 1, textAlign: "right" },
});
