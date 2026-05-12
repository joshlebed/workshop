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
import { Text, tokens } from "../../ui/index";

interface ItemRowProps {
  item: Item;
  /** Section bucket — drives leading affordance + chrome. */
  section: "ordered" | "unordered" | "completed";
  /**
   * Album-shelf only: highlights the row briefly after a refresh that
   * surfaced it as a new detection.
   */
  isNew: boolean;
  /** Library reports `true` while the row is being dragged. */
  isDragging: boolean;
  addedByName: string | null;
  /** List accent hex used to tint cover placeholder + position chip glyph. */
  accent: string;
  onMenu: () => void;
  /** Short-tap on the body (excluding handle/menu) — type-specific destination. */
  onPressBody?: () => void;
  /**
   * Drag-affordance slot — wraps the position chip on ordered rows so the
   * gesture library owns the touch target. Omitted on unordered/completed.
   */
  dragHandle?: (children: ReactNode) => ReactNode;
}

export function ItemRow({
  item,
  section,
  isNew,
  isDragging,
  addedByName,
  accent,
  onMenu,
  onPressBody,
  dragHandle,
}: ItemRowProps) {
  const isCompleted = section === "completed";
  const completedProgress = useSharedValue(isCompleted ? 1 : 0);
  useEffect(() => {
    completedProgress.value = withTiming(isCompleted ? 1 : 0, { duration: 220 });
  }, [isCompleted, completedProgress]);
  const titleStyle = useAnimatedStyle(() => ({ opacity: 1 - completedProgress.value * 0.45 }));

  const view = describeItem(item);
  const provenance = describeProvenance(item, section, addedByName);

  const leading =
    section === "ordered" ? (
      <PositionChip dragHandle={dragHandle} isDragging={isDragging} accent={accent} />
    ) : section === "completed" ? (
      <View style={styles.completedMark}>
        <Text style={styles.completedGlyph}>✓</Text>
      </View>
    ) : dragHandle ? (
      // Unordered rows on web get a drag handle so they can be dragged into
      // the ranked section. Native unordered rows omit `dragHandle` (cross-
      // section drag isn't supported there).
      <PositionChip dragHandle={dragHandle} isDragging={isDragging} accent={accent} />
    ) : null;

  const cover = view.imageUrl ? (
    <Image
      source={{ uri: view.imageUrl }}
      style={[styles.cover, isCompleted && styles.coverCompleted]}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View
      style={[
        styles.cover,
        styles.coverPlaceholder,
        { backgroundColor: `${accent}1F` },
        isCompleted && styles.coverCompleted,
      ]}
    >
      <Text style={styles.coverPlaceholderGlyph}>{view.placeholderGlyph}</Text>
    </View>
  );

  const bodyContent = (
    <>
      {cover}
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
          <Text
            variant="caption"
            tone={isCompleted ? "muted" : "secondary"}
            numberOfLines={1}
            style={styles.subline}
          >
            {view.subline}
          </Text>
        ) : null}
        {provenance ? (
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.provenance}>
            {provenance}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View
      style={[styles.row, isNew && styles.rowNew, isDragging && styles.rowDragging]}
      testID={`item-row-${item.id}`}
    >
      {leading}
      {onPressBody ? (
        <Pressable
          accessibilityRole={view.bodyRole}
          accessibilityLabel={view.bodyLabel}
          onPress={onPressBody}
          testID={`item-row-body-${item.id}`}
          style={({ pressed, hovered }) => [
            styles.bodyPressable,
            (pressed || hovered) && styles.bodyPressed,
          ]}
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
        style={({ pressed, hovered }) => [
          styles.menuBtn,
          (pressed || hovered) && styles.menuBtnHover,
        ]}
        hitSlop={10}
      >
        <Text style={styles.menuGlyph}>⋯</Text>
      </Pressable>
    </View>
  );
}

interface PositionChipProps {
  isDragging: boolean;
  accent: string;
  dragHandle?: (children: ReactNode) => ReactNode;
}

// The chip is the drag handle for ordered rows. The numeric rank used to
// live here, but the rank repeats information the order already conveys,
// so we render a drag glyph instead — visual affordance without the
// duplicated digits eating horizontal space.
function PositionChip({ isDragging, accent, dragHandle }: PositionChipProps) {
  const chip = (
    <View style={[styles.positionChip, isDragging && styles.positionChipDragging]}>
      <Text style={[styles.positionChipText, { color: accent }]}>≡</Text>
    </View>
  );
  return dragHandle ? <>{dragHandle(chip)}</> : chip;
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
): string | null {
  if (section === "completed" && item.completedAt) {
    return `completed ${formatRelative(item.completedAt)}`;
  }
  if (item.type === "album_shelf" && section === "unordered") {
    const meta = item.metadata as Partial<AlbumShelfItemMetadata>;
    const detectedAt = typeof meta.detectedAt === "string" ? meta.detectedAt : null;
    return detectedAt ? `detected ${formatRelative(detectedAt)}` : "detected";
  }
  // Only surface "added by @x" when another collaborator added the row;
  // a list owned and added-to by one person doesn't need the repetition.
  return addedByName ? `added by @${addedByName} · ${formatRelative(item.createdAt)}` : null;
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
      ? "Ranked"
      : kind === "completed"
        ? "Done"
        : isAlbumShelf
          ? "Detected"
          : "To watch";
  return (
    <View style={styles.sectionHeader} testID={`list-detail-section-${kind}`}>
      <Text style={styles.sectionHeaderLabel}>{label}</Text>
      <Text style={styles.sectionHeaderCount}>{count}</Text>
    </View>
  );
}

export function OrderedHint({ isAlbumShelf }: { isAlbumShelf: boolean }) {
  const text = isAlbumShelf
    ? "Drag a detected album up here (or tap ⋯ → Move to ranked) to start ordering."
    : "Drag a row up here (or tap ⋯ → Move to ranked) to start ordering.";
  return (
    <View style={styles.orderedHint} testID="list-detail-ordered-hint">
      <Text variant="caption" tone="secondary">
        {text}
      </Text>
    </View>
  );
}

export const rowStyles = StyleSheet.create({
  // Wrapper passed by the gesture-aware parent. Keeps the touch target the
  // size of the position chip without adding padding around it.
  rowDragHandle: {
    alignItems: "center",
    justifyContent: "center",
  },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  rowNew: { backgroundColor: tokens.accent.muted },
  rowDragging: {
    backgroundColor: tokens.bg.surface,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    // Lift the row off the divider while dragging
    borderBottomColor: "transparent",
  },
  bodyPressable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.md,
  },
  bodyPressed: { backgroundColor: tokens.bg.surface },
  positionChip: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.surface,
  },
  positionChipDragging: { backgroundColor: tokens.bg.elevated },
  positionChipText: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
  },
  completedMark: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.default,
  },
  completedGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.md,
    lineHeight: tokens.font.size.md + 2,
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  coverCompleted: { opacity: 0.5 },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverPlaceholderGlyph: { fontSize: 24 },
  rowBody: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  rowTitle: {
    flexShrink: 1,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.medium,
    letterSpacing: -0.1,
  },
  rowTitleCompleted: { textDecorationLine: "line-through", color: tokens.text.muted },
  subline: { marginTop: 1 },
  provenance: { marginTop: 1 },
  newPill: {
    backgroundColor: tokens.accent.default,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 2,
    borderRadius: tokens.radius.sm,
  },
  newPillText: { fontSize: 10, fontWeight: tokens.font.weight.bold, letterSpacing: 0.5 },
  menuBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  menuBtnHover: { backgroundColor: tokens.bg.surface },
  menuGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.lg,
    lineHeight: tokens.font.size.lg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  sectionHeaderLabel: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  sectionHeaderCount: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.sm,
    fontVariant: ["tabular-nums"],
  },
  orderedHint: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
});
