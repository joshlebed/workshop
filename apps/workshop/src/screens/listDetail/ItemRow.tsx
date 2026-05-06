// Pure presentation for unified list-detail rows + section headers + ordered-hint.
// No drag plumbing here — both list implementations (native +
// react-native-reorderable-list, web + @dnd-kit/sortable) compose the row
// inside their own gesture-aware wrappers.
//
// One row component covers every list type: album-shelf renders the
// Spotify-shaped metadata (cover/artist/year + NEW pill + detected
// timestamp), other types fall back to title + note + an optional poster /
// cover from `metadata.posterUrl` or `metadata.coverUrl` / `image`.

import type { AlbumShelfItemMetadata, Item } from "@workshop/shared";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { formatRelative } from "../../lib/relativeTime";
import { Card, Text, tokens } from "../../ui/index";

interface ItemRowProps {
  item: Item;
  /** Section bucket — drives index label + chrome. */
  section: "ordered" | "unordered" | "completed";
  /** "1", "2", … for ordered; "•" for unordered; "✓" for completed. */
  indexLabel: string;
  /**
   * Album-shelf only: highlights the row briefly after a refresh that
   * surfaced it as a new detection.
   */
  isNew: boolean;
  /** Library reports `true` while the row is being dragged. */
  isDragging: boolean;
  addedByName: string | null;
  onMenu: () => void;
  /** Short-tap on the body (excluding handle/menu) — type-specific destination. */
  onPressBody?: () => void;
  /**
   * Drag-affordance slot. The list impl injects a Pressable / `<div>`
   * wired up to its drag library so the row stays library-agnostic.
   * Omitted on completed rows (not draggable).
   */
  dragHandle?: ReactNode;
}

export function ItemRow({
  item,
  section,
  indexLabel,
  isNew,
  isDragging,
  addedByName,
  onMenu,
  onPressBody,
  dragHandle,
}: ItemRowProps) {
  const isCompleted = section === "completed";
  const completedProgress = useSharedValue(isCompleted ? 1 : 0);
  useEffect(() => {
    completedProgress.value = withTiming(isCompleted ? 1 : 0, { duration: 220 });
  }, [isCompleted, completedProgress]);
  const titleStyle = useAnimatedStyle(() => ({ opacity: 1 - completedProgress.value * 0.4 }));

  const view = describeItem(item);
  const provenance = describeProvenance(item, section, addedByName);

  const bodyContent = (
    <>
      <View style={styles.rowIndex}>
        <Text variant="caption" tone="muted" style={styles.indexText}>
          {indexLabel}
        </Text>
      </View>
      {view.imageUrl ? (
        <Image
          source={{ uri: view.imageUrl }}
          style={styles.cover}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={styles.coverPlaceholderGlyph}>{view.placeholderGlyph}</Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Animated.Text
            numberOfLines={2}
            style={[styles.rowTitle, isCompleted && styles.rowTitleCompleted, titleStyle]}
            testID={`item-title-${item.id}`}
          >
            {item.title}
          </Animated.Text>
          {isNew ? (
            <View style={styles.newPill} testID={`item-row-new-${item.id}`}>
              <Text variant="caption" tone="onAccent" style={styles.newPillText}>
                NEW
              </Text>
            </View>
          ) : null}
        </View>
        {view.subline ? (
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {view.subline}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {provenance}
        </Text>
      </View>
    </>
  );

  return (
    <Card
      style={[styles.row, isNew && styles.rowNew, isDragging && styles.rowDragging]}
      testID={`item-row-${item.id}`}
    >
      {dragHandle ?? <View style={styles.handlePlaceholder} />}
      {onPressBody ? (
        <Pressable
          accessibilityRole={view.bodyRole}
          accessibilityLabel={view.bodyLabel}
          onPress={onPressBody}
          testID={`item-row-body-${item.id}`}
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
        testID={`item-row-menu-${item.id}`}
        style={({ pressed }) => [styles.menuBtn, pressed && styles.menuBtnPressed]}
        hitSlop={10}
      >
        <Text style={styles.menuGlyph}>⋮</Text>
      </Pressable>
    </Card>
  );
}

interface ItemView {
  imageUrl?: string;
  placeholderGlyph: string;
  subline: string;
  bodyRole: "link" | "button";
  bodyLabel: string;
}

function describeItem(item: Item): ItemView {
  const meta = item.metadata as Record<string, unknown>;
  switch (item.type) {
    case "album_shelf": {
      const m = meta as Partial<AlbumShelfItemMetadata>;
      const subline = m.year ? `${m.artist ?? ""} · ${m.year}` : (m.artist ?? "");
      return {
        ...(typeof m.coverUrl === "string" ? { imageUrl: m.coverUrl } : {}),
        placeholderGlyph: "📀",
        subline,
        bodyRole: "link",
        bodyLabel: `Open ${item.title} on Spotify`,
      };
    }
    case "movie":
    case "tv": {
      const poster = typeof meta.posterUrl === "string" ? meta.posterUrl : undefined;
      const year = typeof meta.year === "number" ? String(meta.year) : null;
      const overview = typeof meta.overview === "string" ? meta.overview : null;
      const subline = [year, overview].filter(Boolean).join(" · ");
      return {
        ...(poster ? { imageUrl: poster } : {}),
        placeholderGlyph: item.type === "tv" ? "📺" : "🎬",
        subline,
        bodyRole: "button",
        bodyLabel: `Open ${item.title}`,
      };
    }
    case "book": {
      const cover = typeof meta.coverUrl === "string" ? meta.coverUrl : undefined;
      const authors = Array.isArray(meta.authors) ? (meta.authors as string[]).join(", ") : "";
      const year = typeof meta.year === "number" ? String(meta.year) : null;
      const subline = [authors, year].filter(Boolean).join(" · ");
      return {
        ...(cover ? { imageUrl: cover } : {}),
        placeholderGlyph: "📚",
        subline,
        bodyRole: "button",
        bodyLabel: `Open ${item.title}`,
      };
    }
    case "date_idea":
    case "trip": {
      const image = typeof meta.image === "string" ? meta.image : undefined;
      const siteName = typeof meta.siteName === "string" ? meta.siteName : "";
      const note = item.note ?? "";
      const subline = [siteName, note].filter(Boolean).join(" · ");
      return {
        ...(image ? { imageUrl: image } : {}),
        placeholderGlyph: item.type === "trip" ? "✈️" : "📍",
        subline,
        bodyRole: "button",
        bodyLabel: `Open ${item.title}`,
      };
    }
  }
}

function describeProvenance(
  item: Item,
  section: "ordered" | "unordered" | "completed",
  addedByName: string | null,
): string {
  if (section === "completed" && item.completedAt) {
    return `completed ${formatRelative(item.completedAt)}`;
  }
  if (item.type === "album_shelf" && section === "unordered") {
    const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
    const detectedAt = typeof meta.detectedAt === "string" ? meta.detectedAt : null;
    return detectedAt ? `detected ${formatRelative(detectedAt)}` : "detected";
  }
  return addedByName
    ? `added ${formatRelative(item.createdAt)} by @${addedByName}`
    : `added ${formatRelative(item.createdAt)}`;
}

interface SectionHeaderProps {
  kind: "ordered" | "unordered" | "completed";
  count: number;
  /** Album-shelf renames "UNORDERED" to "DETECTED" since it's auto-detected from Spotify. */
  isAlbumShelf?: boolean;
}

export function SectionHeader({ kind, count, isAlbumShelf = false }: SectionHeaderProps) {
  const label =
    kind === "ordered"
      ? "ORDERED"
      : kind === "completed"
        ? "COMPLETED"
        : isAlbumShelf
          ? "DETECTED"
          : "UNORDERED";
  return (
    <View style={styles.sectionHeader} testID={`list-detail-section-${kind}`}>
      <Text variant="label" tone="secondary">
        {label} ({count})
      </Text>
    </View>
  );
}

export function OrderedHint({ isAlbumShelf }: { isAlbumShelf: boolean }) {
  const text = isAlbumShelf
    ? "Tap ⋮ on a detected album → Move to ordered to start ranking your shelf."
    : "Tap ⋮ on an item → Move to ordered to start ranking.";
  return (
    <View style={styles.orderedHint} testID="list-detail-ordered-hint">
      <Text variant="caption" tone="secondary">
        {text}
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
  bodyPressed: { opacity: 0.7 },
  rowNew: { borderColor: tokens.accent.default, borderWidth: 1 },
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
  rowTitleCompleted: { textDecorationLine: "line-through", color: tokens.text.muted },
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
