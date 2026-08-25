import { Image, type ImageStyle, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Button } from "./Button";
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
  disabled = false,
  testID,
}: SearchResultRowProps) {
  const fullTitle = year ? `${title} (${year})` : title;
  const rowTestId = testID ?? `search-result-${id}`;
  return (
    <Pressable
      testID={rowTestId}
      accessibilityRole="button"
      accessibilityLabel={`Add ${fullTitle}`}
      onPress={disabled || loading ? undefined : onAdd}
      style={({ pressed }) => [styles.row, pressed && !disabled ? styles.rowPressed : null]}
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
      <Button
        testID={`${rowTestId}-add`}
        label="Add"
        size="md"
        variant="secondary"
        loading={loading}
        disabled={disabled || loading}
        onPress={onAdd}
        style={styles.addButton}
      />
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
  rowPressed: { opacity: 0.85 },
  image,
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderGlyph: { fontSize: tokens.font.size.lg },
  body: { flex: 1, gap: 2 },
  addButton: { minWidth: 72 },
});
