import type { ReactNode } from "react";
import {
  type GestureResponderEvent,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Icon } from "./Icon";
import { interaction, type PressState, webAria } from "./interaction";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface ListRowProps {
  /** A string renders in the row title style; pass a node for inline marks. */
  title: ReactNode;
  /** One quiet line. A node may carry its own color (unread emphasis). */
  subtitle?: ReactNode;
  /** Usually an `EmojiBadge` (44) or an `Avatar`. */
  leading?: ReactNode;
  /** Trailing control or meta. `chevron` appends a disclosure chevron. */
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  delayLongPress?: number;
  disabled?: boolean;
  /** Marks the row as the current choice (pickers). */
  selected?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** Extra props for the pressable (e.g. web `onContextMenu`). */
  pressableProps?: Record<string, unknown>;
}

/**
 * The one row: `[leading] title / one quiet subtitle [trailing]`, min height
 * 56, the whole row is the target. Hover, pressed and focus-visible are built
 * in. Used on home, the share picker, activity, the archive and pickers.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  chevron = false,
  onPress,
  onLongPress,
  delayLongPress,
  disabled = false,
  selected,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  pressableProps,
}: ListRowProps) {
  const body = (
    <>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.body}>
        {typeof title === "string" ? (
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle == null || subtitle === "" ? null : typeof subtitle === "string" ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitle
        )}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {chevron ? <Icon name="chevron" size={16} tone="muted" /> : null}
    </>
  );

  if (!onPress && !onLongPress) {
    return (
      <View style={[styles.row, style]} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      {...pressableProps}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected }}
      aria-disabled={disabled}
      // `aria-selected` isn't allowed on a button; the open row of a
      // navigation list is the current page.
      {...webAria({ "aria-current": selected ? "page" : undefined })}
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      delayLongPress={delayLongPress}
      testID={testID}
      style={({ pressed, hovered }: PressState) => [
        styles.row,
        hovered && !disabled ? styles.hovered : null,
        selected ? styles.selected : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

/** Row metrics, shared with `Skeleton.Row` so loading rows match real ones. */
export const listRowMetrics = {
  minHeight: 56,
  // 12 + a 44 badge + 12 = 68, close to the old home row (72) so lists keep
  // their breathing room; text-only rows still floor at 56.
  paddingVertical: tokens.space.md,
  paddingHorizontal: tokens.space.md,
  marginHorizontal: tokens.space.xs,
  gap: tokens.space.md,
} as const;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: listRowMetrics.gap,
    minHeight: listRowMetrics.minHeight,
    paddingVertical: listRowMetrics.paddingVertical,
    paddingHorizontal: listRowMetrics.paddingHorizontal,
    marginHorizontal: listRowMetrics.marginHorizontal,
    borderRadius: tokens.radius.md,
  },
  hovered: { backgroundColor: interaction.hover },
  pressed: { backgroundColor: interaction.pressed },
  selected: { backgroundColor: interaction.pressed },
  disabled: { opacity: 0.5 },
  leading: { position: "relative" },
  body: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
  title: {
    fontWeight: tokens.font.weight.medium,
    letterSpacing: tokens.font.tracking.heading,
  },
  trailing: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
});
