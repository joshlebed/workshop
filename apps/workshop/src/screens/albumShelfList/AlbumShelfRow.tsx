// Pure presentation for album-shelf rows + section headers + ordered-hint.
// No drag plumbing here — both list implementations (native +
// react-native-reorderable-list, web + @dnd-kit/sortable) compose the row
// inside their own gesture-aware wrappers.

import type { AlbumShelfItemMetadata, Item } from "@workshop/shared";
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { formatRelative } from "../../lib/relativeTime";
import { Card, Text, tokens } from "../../ui/index";

interface AlbumShelfRowProps {
  item: Item;
  isOrdered: boolean;
  indexLabel: string;
  isNew: boolean;
  isDragging: boolean;
  addedByName: string | null;
  onMenu: () => void;
  /** Short-tap on the cover/title area — opens the album. */
  onPressBody?: () => void;
  /**
   * Drag-affordance slot. The list impl injects a Pressable / `<div>`
   * wired up to its drag library so the row stays library-agnostic.
   */
  dragHandle?: ReactNode;
}

export function AlbumShelfRow({
  item,
  isOrdered,
  indexLabel,
  isNew,
  isDragging,
  addedByName,
  onMenu,
  onPressBody,
  dragHandle,
}: AlbumShelfRowProps) {
  const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
  const cover = meta.coverUrl;
  const artist = meta.artist ?? "";
  const year = meta.year;
  const subline = year ? `${artist} · ${year}` : artist;
  const detectedAt = typeof meta.detectedAt === "string" ? meta.detectedAt : null;
  const provenance = isOrdered
    ? addedByName
      ? `added ${formatRelative(item.createdAt)} by @${addedByName}`
      : `added ${formatRelative(item.createdAt)}`
    : detectedAt
      ? `detected ${formatRelative(detectedAt)}`
      : "detected";

  const bodyContent = (
    <>
      <View style={styles.rowIndex}>
        <Text variant="caption" tone="muted" style={styles.indexText}>
          {indexLabel}
        </Text>
      </View>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderGlyph}>📀</Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {item.title}
          </Text>
          {isNew ? (
            <View style={styles.newPill} testID={`album-row-new-${item.id}`}>
              <Text variant="caption" tone="onAccent" style={styles.newPillText}>
                NEW
              </Text>
            </View>
          ) : null}
        </View>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {subline}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {provenance}
        </Text>
      </View>
    </>
  );

  return (
    <Card
      style={[styles.row, isNew && styles.rowNew, isDragging && styles.rowDragging]}
      testID={`album-row-${item.id}`}
    >
      {dragHandle ?? <View style={styles.handlePlaceholder} />}
      {onPressBody ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open ${item.title} on Spotify`}
          onPress={onPressBody}
          testID={`album-row-body-${item.id}`}
          style={({ pressed }) => [styles.bodyPressable, pressed && styles.bodyPressed]}
        >
          {bodyContent}
        </Pressable>
      ) : (
        <View style={styles.bodyPressable}>{bodyContent}</View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open menu for ${item.title}`}
        onPress={onMenu}
        testID={`album-row-menu-${item.id}`}
        style={({ pressed }) => [styles.menuBtn, pressed && styles.menuBtnPressed]}
        hitSlop={10}
      >
        <Text style={styles.menuGlyph}>⋮</Text>
      </Pressable>
    </Card>
  );
}

interface SectionHeaderProps {
  kind: "ordered" | "detected";
  count: number;
}

export function SectionHeader({ kind, count }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader} testID={`album-shelf-section-${kind}`}>
      <Text variant="label" tone="secondary">
        {kind === "ordered" ? "ORDERED" : "DETECTED"} ({count})
      </Text>
    </View>
  );
}

export function OrderedHint() {
  return (
    <View style={styles.orderedHint} testID="album-shelf-ordered-hint">
      <Text variant="caption" tone="secondary">
        Long-press a detected album and drag it up here to start ranking your shelf.
      </Text>
    </View>
  );
}

export const rowStyles = StyleSheet.create({
  rowDragHandle: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 32,
  },
  dragHandleGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.size.xl + 2,
  },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
  },
  bodyPressable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  bodyPressed: {
    opacity: 0.7,
  },
  rowNew: {
    borderColor: tokens.accent.default,
    borderWidth: 1,
  },
  rowDragging: {
    opacity: 0.85,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  handlePlaceholder: { width: 32 },
  rowIndex: { width: 24, alignItems: "center" },
  indexText: { fontSize: tokens.font.size.md },
  cover: {
    width: 48,
    height: 48,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverPlaceholderGlyph: { fontSize: 22 },
  rowBody: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  rowTitle: {
    flexShrink: 1,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.regular,
  },
  newPill: {
    backgroundColor: tokens.accent.default,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
    borderRadius: tokens.radius.sm,
  },
  newPillText: { fontSize: 10, fontWeight: tokens.font.weight.bold, letterSpacing: 0.5 },
  menuBtn: { paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.xs },
  menuBtnPressed: { opacity: 0.6 },
  menuGlyph: { fontSize: tokens.font.size.lg, color: tokens.text.secondary },
  sectionHeader: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  orderedHint: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
  },
});
