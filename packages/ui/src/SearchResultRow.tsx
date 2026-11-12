import {
  ActivityIndicator,
  Image,
  type ImageStyle,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import type { PressState } from "./interaction";
import { Text } from "./Text";
import { tokens } from "./theme";

export interface SearchResultRowProps {
  /** Stable identifier for the result, used as `testID` suffix. */
  id: string;
  title: string;
  subtitle?: string | null;
  /** Year shown next to the title when present. */
  year?: number | null;
  /** Poster / cover image. Square-ish; rendered at 56×84. */
  imageUrl?: string | null;
  /** Pressing the row or the Add button calls this. */
  onAdd: () => void;
  /** Disables the Add button while a mutation is pending. */
  loading?: boolean;
  disabled?: boolean;
  /** Already on the list: the Add button reads "On list" and does nothing. */
  onList?: boolean;
  testID?: string;
}

export function SearchResultRow({
  id,
  title,
  subtitle,
  year,
  imageUrl,
  onAdd,
  loading = false,
  disabled: disabledProp = false,
  onList = false,
  testID,
}: SearchResultRowProps) {
  const disabled = disabledProp || onList;
  const fullTitle = year ? `${title} (${year})` : title;
  const rowTestId = testID ?? `search-result-${id}`;
  return (
    <Pressable
      testID={rowTestId}
      accessibilityRole="button"
      accessibilityLabel={onList ? `${fullTitle}, on list` : `Add ${fullTitle}`}
      onPress={disabled || loading ? undefined : onAdd}
      accessibilityState={{ disabled: disabled || loading }}
      aria-disabled={disabled || loading}
      style={({ pressed, hovered }: PressState) => [
        styles.row,
        hovered && !disabled ? styles.rowHovered : null,
        pressed && !disabled ? styles.rowPressed : null,
      ]}
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={styles.image} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          <Text tone="muted" style={styles.placeholderGlyph}>
            ?
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text variant="body" numberOfLines={2}>
          {fullTitle}
        </Text>
        {subtitle ? (
          <Text tone="secondary" variant="caption" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {/* The whole row is the button; a nested <button> is invalid HTML. */}
      <View
        style={[styles.addPill, onList && styles.addPillQuiet]}
        testID={`${rowTestId}-${onList ? "on-list" : "add"}`}
      >
        {loading ? (
          <ActivityIndicator
            size="small"
            color={tokens.text.secondary}
            accessibilityLabel="Adding"
          />
        ) : (
          <Text variant="label" tone={onList ? "muted" : "primary"}>
            {onList ? "On list" : "Add"}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const row: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  gap: tokens.space.md,
  padding: tokens.space.md,
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.bg.surface,
  borderWidth: 1,
  borderColor: tokens.border.subtle,
};

const image: ImageStyle = {
  width: 56,
  height: 84,
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.bg.elevated,
};

const styles = StyleSheet.create({
  row,
  // Background steps, not an opacity fade: surface → elevated on hover,
  // one more step while pressed.
  rowHovered: { backgroundColor: tokens.bg.elevated },
  rowPressed: { backgroundColor: tokens.border.subtle },
  image,
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderGlyph: { fontSize: tokens.font.size.lg, lineHeight: tokens.font.lineHeight.lg },
  body: { flex: 1, gap: tokens.space.xxs },
  addPill: {
    minWidth: 72,
    minHeight: 36,
    paddingHorizontal: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  addPillQuiet: { borderColor: "transparent" },
});
