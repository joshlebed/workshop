// One row in sort mode.
//
// Drag is still there (long-press on native, pointer-drag on web), but it is no
// longer the only way to move a game: ▲ / ▼ keys do the same job with a tap,
// which is the only version that works with a screen reader or a mouse that
// isn't in the mood. The row strips back to identity + position so the reorder
// is the only thing on screen worth reading.

import type { MyGame } from "@workshop/shared/games";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { PixelIcon } from "../../../theme/PixelIcon";
import { Text } from "../../../theme/Text";
import { tokens } from "../../../theme/tokens";

export interface SortRowProps {
  game: MyGame;
  index: number;
  total: number;
  dragging: boolean;
  onMove: (delta: -1 | 1) => void;
  /** Native only — long-press anywhere on the row starts the drag. */
  onLongPress?: () => void;
}

export function SortRow({ game, index, total, dragging, onMove, onLongPress }: SortRowProps) {
  const title = game.game.title;
  return (
    <View style={[styles.row, dragging && styles.rowDragging]} testID={`sort-row-${game.gameId}`}>
      {/* The grip is the drag target on native and the position marker on both:
          hold anywhere on it to lift the row. */}
      <Pressable
        style={styles.grip}
        accessible={false}
        {...(onLongPress ? { onLongPress, delayLongPress: 200 } : {})}
      >
        <Text variant="score" tone="secondary" style={styles.position}>
          {String(index + 1)}
        </Text>
        <PixelIcon name="drag-and-drop" size={16} color={tokens.border.default} />
      </Pressable>
      {game.game.iconUrl ? (
        <Image
          source={{ uri: game.game.iconUrl }}
          style={styles.mark}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.mark, styles.markPlaceholder]}>
          <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
        </View>
      )}
      <Text variant="heading" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <KeyButton
        glyph="arrow-up"
        label={`Move ${title} up`}
        disabled={index === 0}
        onPress={() => onMove(-1)}
        testID={`sort-up-${game.gameId}`}
      />
      <KeyButton
        glyph="arrow-down"
        label={`Move ${title} down`}
        disabled={index === total - 1}
        onPress={() => onMove(1)}
        testID={`sort-down-${game.gameId}`}
      />
    </View>
  );
}

function KeyButton({
  glyph,
  label,
  onPress,
  disabled,
  testID,
}: {
  glyph: "arrow-up" | "arrow-down";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const color = disabled ? tokens.border.default : tokens.text.secondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      testID={testID}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.key,
        (pressed || hovered) && !disabled && styles.keyActive,
      ]}
    >
      <PixelIcon name={glyph} size={16} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingRight: tokens.space.md,
    paddingVertical: tokens.space.sm,
    backgroundColor: tokens.bg.canvas,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  rowDragging: { backgroundColor: tokens.bg.raised },
  grip: {
    width: 42,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.xs,
    alignSelf: "stretch",
    paddingVertical: tokens.space.sm,
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  position: { fontSize: 12 },
  mark: {
    width: 24,
    height: 24,
    marginLeft: tokens.space.md,
    backgroundColor: tokens.bg.raised,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  markPlaceholder: { alignItems: "center", justifyContent: "center" },
  title: { flex: 1, minWidth: 0, fontSize: 11, color: tokens.text.primary },
  // Unboxed: eighteen bezelled squares on one screen is a grid of noise. The
  // row's own rule already separates them.
  key: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  keyActive: { opacity: 0.6 },
});
