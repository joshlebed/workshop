// Pure presentation for list-detail rows + section headers. No drag plumbing
// here: both list implementations (native + react-native-reorderable-list,
// web + @dnd-kit/sortable) compose the row inside their own gesture-aware
// wrappers and hand it the pieces below.
//
// Anatomy (plan §2 "One row"): [check] [cover] title / one quiet line [⋯].
// The whole row except the checkbox and the ⋯ opens the item.

import type { Item, ItemKind } from "@workshop/shared";
import {
  alpha,
  formatRelative,
  haptics,
  Icon,
  IconButton,
  interaction,
  REORDER_ACTIVATION,
  Text,
  tokens,
  webAria,
} from "@workshop/ui";
import { type ReactNode, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { itemPlaceholderGlyph } from "./itemGlyph";

interface ItemRowProps {
  item: Item;
  /** Section bucket — drives leading affordance + chrome. */
  section: "ordered" | "unordered" | "completed";
  /** 1-indexed rank in the whole Ranked block (ranked rows only). */
  rank?: number;
  /** Brief highlight after the row was added or surfaced by a sync. */
  isNew: boolean;
  /** True while the row is lifted by a drag. */
  isDragging: boolean;
  addedByName: string | null;
  /** Wins over the default provenance line (Letterboxd overlap badge). */
  provenanceOverride?: string;
  /** List accent hex: tints the cover placeholder and the rank numeral. */
  accent: string;
  /**
   * The completion checkbox (lists with the to-do feature). Open rows get an
   * empty circle that completes in one tap; Done rows a filled one that
   * reopens. Omitted when the list has no completion.
   */
  checkbox?: {
    checked: boolean;
    onToggle: () => void;
    /** "Mark watched" / "Mark not watched": the hint for assistive tech. */
    hint: string;
  };
  /** "Watched" / "Read" / "Done": the Done row's provenance verb. */
  doneWord?: string;
  /** Show the row's artwork tile (media and link lists; plain lists skip it). */
  showCover: boolean;
  onMenu: () => void;
  onPressBody?: () => void;
  /** Long-press on the body starts a reorder (native). */
  onLongPressBody?: () => void;
  /**
   * Web drag affordance: drawn in the left gutter while the row is hovered or
   * focused, never permanently on every row.
   */
  dragHandle?: ReactNode;
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
  checkbox,
  doneWord = "Done",
  showCover,
  onMenu,
  onPressBody,
  onLongPressBody,
  dragHandle,
}: ItemRowProps) {
  const isCompleted = section === "completed";
  const view = describeItem(item);
  const meta = [
    (item.tags ?? []).join(" · "),
    provenanceOverride ?? describeProvenance(item, section, addedByName, doneWord),
  ]
    .filter(Boolean)
    .join("  ·  ");

  // A broken or hotlink-blocked image falls back to the tinted placeholder.
  // Reset during render when the row recycles onto a different image URL.
  const [imageFailed, setImageFailed] = useState(false);
  const [trackedUrl, setTrackedUrl] = useState(view.imageUrl);
  if (view.imageUrl !== trackedUrl) {
    setTrackedUrl(view.imageUrl);
    setImageFailed(false);
  }
  const showImage = !!view.imageUrl && !imageFailed;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const rankNumeral = typeof rank === "number" && section === "ordered" ? rank : null;
  // With a checkbox in the leading slot the rank moves inline, a quiet
  // tabular figure before the title; without one it keeps the leading slot.
  const leading = checkbox ? (
    <Checkbox
      checked={checkbox.checked}
      onToggle={checkbox.onToggle}
      label={item.title}
      hint={checkbox.hint}
      testID={`item-row-check-${item.id}`}
    />
  ) : rankNumeral !== null ? (
    <View style={styles.rankSlot}>
      <Text style={[styles.rankLeading, { color: accent }]}>{rankNumeral}</Text>
    </View>
  ) : null;

  const cover = !showCover ? null : showImage ? (
    <Image
      source={{ uri: view.imageUrl }}
      style={[styles.cover, isCompleted && styles.coverDone]}
      onError={() => setImageFailed(true)}
      accessibilityIgnoresInvertColors
    />
  ) : (
    <View
      style={[
        styles.cover,
        styles.coverPlaceholder,
        { backgroundColor: alpha(accent, 0.12) },
        isCompleted && styles.coverDone,
      ]}
    >
      <Text style={styles.coverPlaceholderGlyph}>{itemPlaceholderGlyph(item.kind)}</Text>
    </View>
  );

  const bodyContent = (
    <>
      {cover}
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text
            numberOfLines={2}
            style={[styles.rowTitle, isCompleted && styles.rowTitleCompleted]}
            testID={`item-title-${item.id}`}
          >
            {checkbox && rankNumeral !== null ? (
              <Text style={[styles.rankInline, { color: accent }]}>{`${rankNumeral}  `}</Text>
            ) : null}
            {item.title}
          </Text>
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
        {meta ? (
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View
      style={[styles.row, isNew && styles.rowNew, isDragging && styles.rowDragging]}
      testID={`item-row-${item.id}`}
      {...(isNew ? { dataSet: { new: "true" } } : {})}
    >
      {dragHandle ? (
        <View
          style={[styles.handle, (hovered || focused || isDragging) && styles.handleVisible]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {dragHandle}
        </View>
      ) : null}
      {leading}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={view.bodyLabel(item.title)}
        onPress={onPressBody}
        // Shared hold threshold (500ms, the iOS long-press minimum).
        onLongPress={onLongPressBody}
        delayLongPress={REORDER_ACTIVATION.longPressMs}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        testID={`item-row-body-${item.id}`}
        style={({ pressed, hovered: h }: { pressed: boolean; hovered?: boolean }) => [
          styles.bodyPressable,
          h && styles.bodyHovered,
          pressed && styles.bodyPressed,
        ]}
      >
        {bodyContent}
      </Pressable>
      <IconButton
        icon="more"
        iconTone="secondary"
        accessibilityLabel={`Actions for ${item.title}`}
        onPress={onMenu}
        testID={`item-row-menu-${item.id}`}
        style={styles.menuBtn}
      />
    </View>
  );
}

function Checkbox({
  checked,
  onToggle,
  label,
  hint,
  testID,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={label}
      accessibilityHint={hint}
      {...webAria({ title: hint })}
      onPress={() => {
        haptics.selection();
        onToggle();
      }}
      testID={testID}
      style={styles.checkTarget}
    >
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
        <View
          style={[
            styles.checkCircle,
            checked && styles.checkCircleOn,
            !checked && (hovered || pressed) && styles.checkCircleHover,
          ]}
        >
          {checked || hovered ? (
            <Icon name="check" size={12} tone={checked ? "primary" : "muted"} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

interface ItemView {
  imageUrl?: string;
  subline: string;
  bodyLabel: (title: string) => string;
}

const openLabel = (title: string) => `Open ${title}`;

/**
 * The one quiet line under the title. What people wrote wins over what was
 * fetched (2.9): a note replaces a movie's overview or a link's site name.
 */
function describeItem(item: Item): ItemView {
  const c = item.content as Record<string, unknown>;
  const note = item.note?.trim() || null;
  switch (item.kind) {
    case "spotify_album": {
      const subline =
        typeof c.year === "number" ? `${c.artist ?? ""} · ${c.year}` : ((c.artist as string) ?? "");
      return {
        ...(typeof c.coverUrl === "string" ? { imageUrl: c.coverUrl } : {}),
        subline: note ?? subline,
        bodyLabel: (t) => `Open ${t} on Spotify`,
      };
    }
    case "movie":
    case "tv": {
      const poster = typeof c.posterUrl === "string" ? c.posterUrl : undefined;
      const year = typeof c.year === "number" ? String(c.year) : null;
      const overview = typeof c.overview === "string" ? c.overview : null;
      return {
        ...(poster ? { imageUrl: poster } : {}),
        subline: [year, note ?? overview].filter(Boolean).join(" · "),
        bodyLabel: openLabel,
      };
    }
    case "book": {
      const cover = typeof c.coverUrl === "string" ? c.coverUrl : undefined;
      const authors = Array.isArray(c.authors) ? (c.authors as string[]).join(", ") : "";
      const year = typeof c.year === "number" ? String(c.year) : null;
      return {
        ...(cover ? { imageUrl: cover } : {}),
        subline: note ?? [authors, year].filter(Boolean).join(" · "),
        bodyLabel: openLabel,
      };
    }
    case "link": {
      const image =
        typeof c.imageProxy === "string"
          ? c.imageProxy
          : typeof c.image === "string"
            ? c.image
            : typeof c.thumbnailUrl === "string"
              ? c.thumbnailUrl
              : undefined;
      const siteName = typeof c.siteName === "string" ? c.siteName : "";
      return {
        ...(image ? { imageUrl: image } : {}),
        subline: note ?? siteName,
        bodyLabel: openLabel,
      };
    }
    default:
      return { subline: note ?? "", bodyLabel: openLabel };
  }
}

function describeProvenance(
  item: Item,
  section: "ordered" | "unordered" | "completed",
  addedByName: string | null,
  doneWord: string,
): string | null {
  if (section === "completed" && item.completedAt) {
    return `${doneWord} ${formatRelative(item.completedAt)}`;
  }
  if (item.kind === "spotify_album" && section === "unordered") {
    const c = item.content as { detectedAt?: string };
    const detectedAt = typeof c.detectedAt === "string" ? c.detectedAt : null;
    return detectedAt ? `Detected ${formatRelative(detectedAt)}` : "Detected";
  }
  // Attribution only when someone else added the row, first name only.
  if (!addedByName) return null;
  const first = addedByName.trim().split(/\s+/)[0] ?? addedByName;
  return `Added by ${first} · ${formatRelative(item.createdAt)}`;
}

interface SectionHeaderProps {
  kind: "ordered" | "unordered" | "completed";
  count: number;
  listItemKind: ItemKind | null;
  /** The list's completion word, for the Done header. */
  doneWord: string;
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

export function SectionHeader({
  kind,
  count,
  listItemKind,
  doneWord,
  collapsible,
}: SectionHeaderProps) {
  const label =
    kind === "ordered"
      ? "Ranked"
      : kind === "completed"
        ? doneWord
        : UNORDERED_LABEL_BY_KIND[listItemKind ?? "plain"];

  const body = (
    <View style={styles.sectionHeader}>
      <Text
        variant="eyebrow"
        tone="secondary"
        accessibilityRole={collapsible ? undefined : "header"}
      >
        {label}
      </Text>
      <Text variant="eyebrow" style={styles.sectionHeaderCount}>
        {count}
      </Text>
      {collapsible ? (
        <View style={styles.sectionHeaderToggle}>
          <Text variant="eyebrow">{collapsible.collapsed ? "Show" : "Hide"}</Text>
          <Icon
            name="chevron-down"
            size={12}
            tone="muted"
            style={collapsible.collapsed ? undefined : styles.chevronUp}
          />
        </View>
      ) : null}
    </View>
  );

  if (!collapsible) {
    return <View testID={`list-detail-section-${kind}`}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${collapsible.collapsed ? "Show" : "Hide"} ${label.toLowerCase()}, ${count}`}
      aria-expanded={!collapsible.collapsed}
      onPress={collapsible.onToggle}
      testID={`list-detail-section-${kind}`}
      style={({ hovered, pressed }: { pressed: boolean; hovered?: boolean }) => [
        styles.sectionHeaderPressable,
        hovered && { backgroundColor: interaction.hover },
        pressed && { backgroundColor: interaction.pressed },
      ]}
    >
      {body}
    </Pressable>
  );
}

/**
 * The empty Ranked section as a drop target. Web shows it only while a row is
 * being dragged; native keeps a constant-height cell (its reorder library
 * measures cells once) whenever Ranked is empty.
 */
export function RankedDropZone({ active }: { active: boolean }) {
  // Web floats this over the top of the list for the length of a drag, so it
  // stays one compact line; native's cell carries the section label too.
  if (Platform.OS === "web") {
    return (
      <View
        testID="list-detail-ranked-drop"
        style={[styles.dropZone, styles.dropZoneCompact, active && styles.dropZoneActive]}
      >
        <Text variant="caption" tone={active ? "secondary" : "muted"}>
          Drop here to rank
        </Text>
      </View>
    );
  }
  return (
    <View testID="list-detail-ranked-drop">
      <View style={styles.sectionHeader}>
        <Text variant="eyebrow" tone="secondary">
          Ranked
        </Text>
      </View>
      <View style={[styles.dropZone, active && styles.dropZoneActive]}>
        <Text variant="caption" tone={active ? "secondary" : "muted"}>
          Hold a row and drag it here to rank it
        </Text>
      </View>
    </View>
  );
}

const CHECK = 22;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 56,
    paddingVertical: tokens.space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
    backgroundColor: tokens.bg.canvas,
  },
  // Just added or just synced: a faint warm wash that clears after a moment.
  rowNew: { backgroundColor: alpha(tokens.accent.default, 0.07) },
  // Lifted: a neutral drop shadow and a slight scale (DESIGN.md: no colored
  // glow), on the surface step so it reads above its neighbours.
  rowDragging: {
    backgroundColor: tokens.bg.surface,
    boxShadow: "0px 8px 20px rgba(0, 0, 0, 0.45)",
    elevation: 8,
    borderBottomColor: "transparent",
    borderRadius: tokens.radius.md,
    transform: [{ scale: 1.02 }],
  },
  handle: {
    position: "absolute",
    left: -tokens.space.xl,
    top: 0,
    bottom: 0,
    width: tokens.space.xl,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
  },
  handleVisible: { opacity: 1 },
  bodyPressable: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: tokens.hit,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.md,
  },
  bodyHovered: { backgroundColor: interaction.hover },
  bodyPressed: { backgroundColor: interaction.pressed },
  // A 44pt target around the 22pt circle; the negative margins keep the
  // visual slot 32 wide so titles line up with the list's left edge.
  checkTarget: {
    width: tokens.hit,
    height: tokens.hit,
    marginLeft: -(tokens.hit - CHECK) / 2,
    marginRight: -tokens.space.xs,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.pill,
  },
  checkCircle: {
    width: CHECK,
    height: CHECK,
    borderRadius: CHECK / 2,
    borderWidth: 1.5,
    borderColor: tokens.border.strong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleHover: { borderColor: tokens.text.secondary },
  checkCircleOn: { backgroundColor: tokens.border.strong, borderColor: tokens.border.strong },
  rankSlot: { width: 28, alignItems: "center", justifyContent: "center" },
  rankLeading: {
    fontSize: tokens.font.size.lg,
    lineHeight: 24,
    fontWeight: tokens.font.weight.semibold,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  rankInline: {
    fontWeight: tokens.font.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  coverDone: { opacity: 0.5 },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  // Pin lineHeight so iOS doesn't clip the emoji to the body line box.
  // Dimmed: a column of identical placeholder glyphs should recede behind
  // real artwork, not compete with it.
  coverPlaceholderGlyph: { fontSize: 20, lineHeight: 24, opacity: 0.55 },
  rowBody: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  rowTitle: {
    flexShrink: 1,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    lineHeight: 22,
    fontWeight: tokens.font.weight.medium,
    letterSpacing: -0.1,
  },
  rowTitleCompleted: { textDecorationLine: "line-through", color: tokens.text.muted },
  subline: { marginTop: 1 },
  meta: { marginTop: 1 },
  // 44pt target; the negative margin keeps the old 32pt visual footprint.
  menuBtn: { marginHorizontal: -tokens.space.xsm, borderRadius: tokens.radius.sm },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: tokens.hit,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.xs,
  },
  sectionHeaderCount: {
    fontWeight: tokens.font.weight.medium,
    fontVariant: ["tabular-nums"],
  },
  sectionHeaderToggle: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
  },
  chevronUp: { transform: [{ rotate: "180deg" }] },
  sectionHeaderPressable: {
    borderRadius: tokens.radius.sm,
    marginHorizontal: -tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
  },
  dropZone: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.border.default,
  },
  dropZoneCompact: { minHeight: tokens.hit, marginTop: tokens.space.sm },
  dropZoneActive: {
    borderColor: tokens.accent.default,
    backgroundColor: alpha(tokens.accent.default, 0.08),
  },
});
