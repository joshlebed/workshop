// Pure presentation for unified list-detail rows + section headers + ordered-hint.
// No drag plumbing here — both list implementations (native +
// react-native-reorderable-list, web + @dnd-kit/sortable) compose the row
// inside their own gesture-aware wrappers.
//
// One row component covers every list type: album-shelf renders the
// Spotify-shaped metadata (cover/artist/year + NEW pill + detected
// timestamp), other types fall back to title + note + an optional poster /
// cover from `metadata.posterUrl` or `metadata.coverUrl` / `image`.

import type { Item, ItemKind } from "@workshop/shared";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { formatRelative } from "../../lib/relativeTime";
import { Text, tokens } from "../../ui/index";

interface ItemRowProps {
  item: Item;
  /** Section bucket — drives leading affordance + chrome. */
  section: "ordered" | "unordered" | "completed";
  /**
   * 1-indexed position inside the ordered section. Only used when section ===
   * "ordered" — the rank number replaces the previous drag-glyph placeholder
   * so the ordered position is visible at a glance instead of being implied.
   */
  rank?: number;
  /**
   * Album-shelf only: highlights the row briefly after a refresh that
   * surfaced it as a new detection.
   */
  isNew: boolean;
  /** Library reports `true` while the row is being dragged. */
  isDragging: boolean;
  addedByName: string | null;
  /**
   * Pre-built provenance line that wins over the default "Added by …" /
   * "completed …" logic. Leaderboard lists use this to swap attribution for
   * "X of Y played".
   */
  provenanceOverride?: string;
  /** List accent hex used to tint cover placeholder + position chip glyph. */
  accent: string;
  /**
   * Tap-to-uncomplete: when the row is in the completed section, the
   * checkmark turns into a Pressable that fires this. Saves a row-menu
   * trip for the common "oops, I checked the wrong one" recovery — and
   * for the active "checking off as we go" flow, it makes the completed
   * row itself reversible with one tap. Omit on rows that can't be
   * toggled (album_shelf items don't support completion at all).
   */
  onTapCompleted?: () => void;
  onMenu: () => void;
  /** Short-tap on the body (excluding handle/menu) — type-specific destination. */
  onPressBody?: () => void;
  /**
   * If provided, the cover image becomes its own Pressable target —
   * separate from the body tap. Used for game rows where tapping the
   * thumbnail opens the game URL while tapping the rest of the row opens
   * the leaderboard.
   */
  onPressCover?: () => void;
  /**
   * Long-press on the body initiates reorder. The platform-specific
   * `ItemList` wrapper supplies this — native binds it to
   * `useReorderableDrag()`, web is driven by `@dnd-kit`'s `TouchSensor`
   * delay-activation. Omitted on rows that aren't reorderable in a given
   * section.
   */
  onLongPressBody?: () => void;
  /**
   * Drag-affordance slot — wraps the position chip on ordered rows so the
   * gesture library can render the visual affordance + (on web) host the
   * drag-listener spread. The activation gesture itself now lives on the
   * row body, not the chip, so this slot is purely visual on native.
   */
  dragHandle?: (children: ReactNode) => ReactNode;
}

export function ItemRow({
  item,
  section,
  rank,
  isNew,
  isDragging,
  addedByName,
  provenanceOverride,
  accent,
  onTapCompleted,
  onMenu,
  onPressBody,
  onPressCover,
  onLongPressBody,
  dragHandle,
}: ItemRowProps) {
  const isCompleted = section === "completed";
  // Crossfade the cover when a row's completed state changes — gives the
  // checkbox flip a visible echo. The title relies on strikethrough alone;
  // doubling up with opacity made completed rows feel washed out.
  const completedProgress = useSharedValue(isCompleted ? 1 : 0);
  useEffect(() => {
    completedProgress.value = withTiming(isCompleted ? 1 : 0, { duration: 220 });
  }, [isCompleted, completedProgress]);
  const coverStyle = useAnimatedStyle(() => ({ opacity: 1 - completedProgress.value * 0.5 }));

  const view = describeItem(item);
  const provenance = provenanceOverride ?? describeProvenance(item, section, addedByName);

  // A broken or hotlink-blocked image (common for scraped place/link covers
  // on web) used to fall through to a bare elevated square, which reads as a
  // loading bug. Track load failure and fall back to the tinted placeholder
  // glyph instead. Reset during render (not an effect) when the row recycles
  // onto a different image URL — the React-blessed "reset state on prop change".
  const [imageFailed, setImageFailed] = useState(false);
  const [trackedUrl, setTrackedUrl] = useState(view.imageUrl);
  if (view.imageUrl !== trackedUrl) {
    setTrackedUrl(view.imageUrl);
    setImageFailed(false);
  }
  const showImage = !!view.imageUrl && !imageFailed;

  const leading =
    section === "ordered" ? (
      <PositionChip
        dragHandle={dragHandle}
        isDragging={isDragging}
        accent={accent}
        rank={typeof rank === "number" ? rank : null}
      />
    ) : section === "completed" ? (
      onTapCompleted ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mark ${item.title} as not done`}
          onPress={onTapCompleted}
          testID={`item-row-uncomplete-${item.id}`}
          hitSlop={8}
          style={({ pressed, hovered }) => [
            styles.completedMark,
            (pressed || hovered) && styles.completedMarkHover,
          ]}
        >
          <Text style={styles.completedGlyph}>✓</Text>
        </Pressable>
      ) : (
        <View style={styles.completedMark}>
          <Text style={styles.completedGlyph}>✓</Text>
        </View>
      )
    ) : dragHandle ? (
      // Unordered rows on web get a drag handle so they can be dragged into
      // the ranked section. Native unordered rows omit `dragHandle` (cross-
      // section drag isn't supported there). No rank yet — render the drag
      // glyph instead of a number.
      <PositionChip dragHandle={dragHandle} isDragging={isDragging} accent={accent} rank={null} />
    ) : null;

  const coverInner = showImage ? (
    <Animated.Image
      source={{ uri: view.imageUrl }}
      style={[styles.cover, coverStyle]}
      onError={() => setImageFailed(true)}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <Animated.View
      style={[
        styles.cover,
        styles.coverPlaceholder,
        { backgroundColor: `${accent}1F` },
        coverStyle,
      ]}
    >
      <Text style={styles.coverPlaceholderGlyph}>{view.placeholderGlyph}</Text>
    </Animated.View>
  );

  // For game rows the thumbnail launches the game URL — give it its own
  // Pressable so it's not part of the body's leaderboard-tap target.
  const cover = onPressCover ? (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Play ${item.title}`}
      onPress={onPressCover}
      hitSlop={6}
      testID={`item-row-cover-${item.id}`}
      style={({ pressed }) => [styles.coverPressable, pressed && styles.coverPressed]}
    >
      {coverInner}
    </Pressable>
  ) : (
    coverInner
  );

  const bodyContent = (
    <>
      {onPressCover ? null : cover}
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text
            numberOfLines={2}
            style={[styles.rowTitle, isCompleted && styles.rowTitleCompleted]}
            testID={`item-title-${item.id}`}
          >
            {item.title}
          </Text>
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
      {onPressCover ? cover : null}
      {onPressBody || onLongPressBody ? (
        <Pressable
          accessibilityRole={view.bodyRole}
          accessibilityLabel={view.bodyLabel}
          onPress={onPressBody}
          // ~250ms feels like iOS's native edit-mode press without
          // intercepting honest taps. The kebab Pressable inside this row
          // owns its own touch via the responder system, so long-press
          // here doesn't compete with the menu button.
          onLongPress={onLongPressBody}
          delayLongPress={250}
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
  rank: number | null;
  dragHandle?: (children: ReactNode) => ReactNode;
}

// Ordered rows display their rank as a bare accent-colored numeral; the
// glyph IS the information, so a filled chip background only competes with
// the adjacent cover thumbnail. Web unordered rows that can be dragged into
// the ordered section show a muted `≡` instead — present but quieter than
// the ranked numerals so the visual hierarchy reads "ranks first, drag
// affordance second."
function PositionChip({ isDragging, accent, rank, dragHandle }: PositionChipProps) {
  const chip = (
    <View style={[styles.positionSlot, isDragging && styles.positionSlotDragging]}>
      {rank !== null ? (
        <Text style={[styles.positionRank, { color: accent }]}>{rank}</Text>
      ) : (
        <Text style={styles.positionDragGlyph}>≡</Text>
      )}
    </View>
  );
  return dragHandle ? dragHandle(chip) : chip;
}

interface ItemView {
  imageUrl?: string;
  placeholderGlyph: string;
  subline: string;
  bodyRole: "link" | "button";
  bodyLabel: string;
}

function describeItem(item: Item): ItemView {
  const c = item.content as Record<string, unknown>;
  switch (item.kind) {
    case "spotify_album": {
      const subline =
        typeof c.year === "number" ? `${c.artist ?? ""} · ${c.year}` : ((c.artist as string) ?? "");
      return {
        ...(typeof c.coverUrl === "string" ? { imageUrl: c.coverUrl } : {}),
        placeholderGlyph: "📀",
        subline,
        bodyRole: "link",
        bodyLabel: `Open ${item.title} on Spotify`,
      };
    }
    case "movie":
    case "tv": {
      const poster = typeof c.posterUrl === "string" ? c.posterUrl : undefined;
      const year = typeof c.year === "number" ? String(c.year) : null;
      const overview = typeof c.overview === "string" ? c.overview : null;
      const subline = [year, overview].filter(Boolean).join(" · ");
      return {
        ...(poster ? { imageUrl: poster } : {}),
        placeholderGlyph: item.kind === "tv" ? "📺" : "🎬",
        subline,
        bodyRole: "button",
        bodyLabel: `Open ${item.title}`,
      };
    }
    case "book": {
      const cover = typeof c.coverUrl === "string" ? c.coverUrl : undefined;
      const authors = Array.isArray(c.authors) ? (c.authors as string[]).join(", ") : "";
      const year = typeof c.year === "number" ? String(c.year) : null;
      const subline = [authors, year].filter(Boolean).join(" · ");
      return {
        ...(cover ? { imageUrl: cover } : {}),
        placeholderGlyph: "📚",
        subline,
        bodyRole: "button",
        bodyLabel: `Open ${item.title}`,
      };
    }
    case "link": {
      // `link` covers date ideas, trips, games, and any generic URL-bearing
      // item. Prefer `imageProxy` (wsrv.nl-wrapped) for rendering so we get
      // resize + format negotiation and survive the upstream hotlink-blocking
      // case. Fall back to `image`, then the legacy `thumbnailUrl` shape.
      const image =
        typeof c.imageProxy === "string"
          ? c.imageProxy
          : typeof c.image === "string"
            ? c.image
            : typeof c.thumbnailUrl === "string"
              ? c.thumbnailUrl
              : undefined;
      const siteName = typeof c.siteName === "string" ? c.siteName : "";
      const note = item.note ?? "";
      const subline = [siteName, note].filter(Boolean).join(" · ");
      return {
        ...(image ? { imageUrl: image } : {}),
        placeholderGlyph: "🔗",
        subline,
        bodyRole: "button",
        bodyLabel: `Open ${item.title}`,
      };
    }
    case "plain":
    default: {
      const note = item.note ?? "";
      return {
        placeholderGlyph: "📝",
        subline: note,
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
  if (item.kind === "spotify_album" && section === "unordered") {
    const c = item.content as { detectedAt?: string };
    const detectedAt = typeof c.detectedAt === "string" ? c.detectedAt : null;
    return detectedAt ? `detected ${formatRelative(detectedAt)}` : "detected";
  }
  // Only surface attribution when another collaborator added the row; a list
  // owned and added-to by one person doesn't need the repetition. Use the
  // bare first name (no "@" handle prefix) — calmer.
  if (!addedByName) return null;
  const first = addedByName.trim().split(/\s+/)[0] ?? addedByName;
  return `Added by ${first} · ${formatRelative(item.createdAt)}`;
}

interface SectionHeaderProps {
  kind: "ordered" | "unordered" | "completed";
  count: number;
  /** Drives the kind-specific copy on the unordered + completed labels. */
  listItemKind: ItemKind | null;
  /** When provided, the header becomes a Pressable that toggles section collapse. */
  collapsible?: { collapsed: boolean; onToggle: () => void };
}

const UNORDERED_LABEL_BY_KIND: Record<ItemKind, string> = {
  movie: "Watchlist",
  tv: "Watchlist",
  book: "Reading",
  link: "Ideas",
  spotify_album: "Detected",
  plain: "Up next",
};

const COMPLETED_LABEL_BY_KIND: Record<ItemKind, string> = {
  movie: "Watched",
  tv: "Watched",
  book: "Read",
  link: "Tried",
  spotify_album: "Done",
  plain: "Done",
};

export function SectionHeader({ kind, count, listItemKind, collapsible }: SectionHeaderProps) {
  const itemKind = listItemKind ?? "plain";
  const label =
    kind === "ordered"
      ? "Ranked"
      : kind === "completed"
        ? COMPLETED_LABEL_BY_KIND[itemKind]
        : UNORDERED_LABEL_BY_KIND[itemKind];

  const body = (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderLabel}>{label}</Text>
      <Text style={styles.sectionHeaderCount}>{count}</Text>
      {collapsible ? (
        <Text style={styles.sectionHeaderToggle}>{collapsible.collapsed ? "Show" : "Hide"}</Text>
      ) : null}
    </View>
  );

  if (!collapsible) {
    return <View testID={`list-detail-section-${kind}`}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collapsible.collapsed ? "Show" : "Hide"} ${label.toLowerCase()} section`}
      onPress={collapsible.onToggle}
      testID={`list-detail-section-${kind}`}
      style={({ hovered, pressed }) => [
        styles.sectionHeaderPressable,
        (hovered || pressed) && styles.sectionHeaderPressableHover,
      ]}
    >
      {body}
    </Pressable>
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
    boxShadow: "0px 6px 12px rgba(0, 0, 0, 0.35)",
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
  positionSlot: {
    // Narrower than before (28 vs 36): the rank glyph IS the affordance, so
    // there's no chip background to host. Width is consistent across ordered
    // + unordered rows so cover thumbnails align across sections.
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  positionSlotDragging: { opacity: 0.6 },
  positionRank: {
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  positionDragGlyph: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.regular,
  },
  completedMark: {
    // Width matches `positionSlot` so the cover edge aligns across sections.
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.border.default,
    backgroundColor: "transparent",
  },
  completedMarkHover: {
    borderColor: tokens.border.strong,
    backgroundColor: tokens.bg.surface,
  },
  completedGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 2,
    fontWeight: tokens.font.weight.semibold,
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  coverPressable: {
    borderRadius: tokens.radius.md,
  },
  coverPressed: { opacity: 0.7 },
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
    alignItems: "center",
    gap: tokens.space.sm,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.xs,
  },
  // Eyebrow style per DESIGN.md: uppercase, tracked, secondary tone. Reads
  // as a divider rather than a heading — matches "calm by default."
  sectionHeaderLabel: {
    color: tokens.text.secondary,
    fontSize: 11,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionHeaderCount: {
    color: tokens.text.muted,
    fontSize: 11,
    fontWeight: tokens.font.weight.medium,
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.4,
  },
  sectionHeaderToggle: {
    marginLeft: "auto",
    color: tokens.text.muted,
    fontSize: 11,
    fontWeight: tokens.font.weight.medium,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  sectionHeaderPressable: {
    borderRadius: tokens.radius.sm,
    marginHorizontal: -tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
  },
  sectionHeaderPressableHover: {
    backgroundColor: tokens.bg.surface,
  },
  orderedHint: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
});
