// Pure presentation for list-detail rows + section headers. No drag plumbing
// here: both list implementations (native + react-native-reorderable-list,
// web + @dnd-kit/sortable) compose the row inside their own gesture-aware
// wrappers and hand it the pieces below.
//
// Anatomy (plan §2 "One row"): [check] [cover] title / one quiet line [⋯].
// The whole row except the checkbox and the ⋯ opens the item.

import type { Item } from "@workshop/shared";
import {
  alpha,
  formatRelative,
  Icon,
  IconButton,
  interaction,
  layout,
  REORDER_ACTIVATION,
  Text,
  timing,
  tokens,
  webAria,
  webSpaceKey,
} from "@workshop/ui";
import { type ReactNode, useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { keepFocusOn } from "../../lib/a11y/keepFocusNear";
import { itemPlaceholderGlyph } from "./itemGlyph";
import type { Section } from "./types";

interface ItemRowProps {
  item: Item;
  /** Section bucket — drives leading affordance + chrome. */
  section: Section;
  /** Brief highlight after the row was added or surfaced by a sync. */
  isNew: boolean;
  /** True while the row is lifted by a drag. */
  isDragging: boolean;
  addedByName: string | null;
  /** Wins over the default provenance line (Letterboxd overlap badge). */
  provenanceOverride?: string;
  /** List accent hex: tints the cover placeholder. */
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

  const leading = checkbox ? (
    <Checkbox
      checked={checkbox.checked}
      onToggle={checkbox.onToggle}
      label={item.title}
      hint={checkbox.hint}
      testID={`item-row-check-${item.id}`}
    />
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
      // Decorative stand-in art: not part of the row's name.
      aria-hidden
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
            {item.title}
          </Text>
        </View>
        {view.subline ? (
          <Text variant="caption" tone={isCompleted ? "muted" : "secondary"} numberOfLines={1}>
            {view.subline}
          </Text>
        ) : null}
        {meta ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View
      style={[styles.row, isDragging && styles.rowDragging]}
      testID={`item-row-${item.id}`}
      {...(isNew ? { dataSet: { new: "true" } } : {})}
    >
      <NewRowWash on={isNew && !isDragging} />
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
        // No label: the name is the row's own text (title, line, tags), so
        // a voice-control user can say what they see (WCAG 2.5.3).
        accessibilityHint={view.bodyHint}
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

/**
 * The new-row highlight (2.6): on at once while the row is new, then fades
 * out at `slow` when the highlight ends instead of blinking off. Opacity only,
 * so it plays under reduced motion too.
 */
function NewRowWash({ on }: { on: boolean }) {
  const opacity = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    opacity.value = on ? 1 : withTiming(0, timing("slow"));
  }, [on, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[styles.wash, style]} />;
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
  // The row moves into Done (or back) and remounts there: keep keyboard focus
  // on this checkbox instead of dropping it to <body> (web; no-op on native).
  const toggle = () => {
    keepFocusOn(testID);
    onToggle();
  };
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      aria-checked={checked}
      accessibilityLabel={label}
      accessibilityHint={hint}
      {...webAria({ title: hint })}
      // The haptic (`light`, a committing tap) fires in the toggle handler.
      onPress={toggle}
      // Space toggles a checkbox on web too (react-native-web maps it to buttons only).
      {...webSpaceKey(toggle)}
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
  /** Where pressing the row goes, when it isn't the item's detail. */
  bodyHint?: string;
}

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
        bodyHint: "Opens in Spotify",
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
      };
    }
    case "book": {
      const cover = typeof c.coverUrl === "string" ? c.coverUrl : undefined;
      const authors = Array.isArray(c.authors) ? (c.authors as string[]).join(", ") : "";
      const year = typeof c.year === "number" ? String(c.year) : null;
      return {
        ...(cover ? { imageUrl: cover } : {}),
        subline: note ?? [authors, year].filter(Boolean).join(" · "),
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
      };
    }
    default:
      return { subline: note ?? "" };
  }
}

function describeProvenance(
  item: Item,
  section: Section,
  addedByName: string | null,
  doneWord: string,
): string | null {
  if (section === "completed" && item.completedAt) {
    return `${doneWord} ${formatRelative(item.completedAt)}`;
  }
  // An inbox row says when the sync found it (the album shelf's `detectedAt`).
  if (section === "inbox") {
    const c = item.content as { detectedAt?: string };
    const at = typeof c.detectedAt === "string" ? c.detectedAt : item.createdAt;
    return `Added ${formatRelative(at)}`;
  }
  // Attribution only when someone else added the row, first name only.
  if (!addedByName) return null;
  const first = addedByName.trim().split(/\s+/)[0] ?? addedByName;
  return `Added by ${first} · ${formatRelative(item.createdAt)}`;
}

interface SectionHeaderProps {
  /** `inbox` (the sync inbox, titled for its source) or `completed` (Done). */
  kind: "inbox" | "completed";
  /** The heading: the inbox's "New from Spotify", or the list's Done word. */
  label: string;
  count: number;
  collapsible?: { collapsed: boolean; onToggle: () => void };
  /** The first thing in the list: no section space above it. */
  first?: boolean;
}

export function SectionHeader({
  kind,
  label,
  count,
  collapsible,
  first = false,
}: SectionHeaderProps) {
  const body = (
    <View style={[styles.sectionHeader, first && styles.sectionHeaderFirst]}>
      <Text
        variant="eyebrow"
        tone="secondary"
        // A level-2 heading under the list's title; the collapsible Done
        // header is a button instead (a heading can't sit inside one).
        headerRole={collapsible ? false : 2}
      >
        {label}
      </Text>
      <Text variant="eyebrow" style={styles.sectionHeaderCount}>
        {count}
      </Text>
      {collapsible ? (
        <View style={styles.sectionHeaderToggle}>
          <Text variant="eyebrow">{collapsible.collapsed ? "Show" : "Hide"}</Text>
          <SectionChevron up={!collapsible.collapsed} />
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
      // Named by its own text ("Done 1 Hide", WCAG 2.5.3); state is aria-expanded.
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

/** The Done toggle's chevron turns with the section (`fast`); snaps under reduced motion. */
function SectionChevron({ up }: { up: boolean }) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(up ? 1 : 0);
  useEffect(() => {
    turn.value = reduceMotion ? (up ? 1 : 0) : withTiming(up ? 1 : 0, timing("fast"));
  }, [up, turn, reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Icon name="chevron-down" size={12} tone="muted" />
    </Animated.View>
  );
}

/**
 * Where an inbox row goes while nothing is placed yet (a freshly connected
 * album shelf): a quiet dashed cell at the top of the list. Native keeps it as
 * a constant-height cell in the reorderable data (its library measures cells
 * once); web draws it above the inbox heading. `active` while a row is over it.
 */
export function ListDropZone({ active, label }: { active: boolean; label: string }) {
  return (
    <View
      testID="list-detail-list-drop"
      style={[styles.dropZone, styles.dropZoneFirst, active && styles.dropZoneActive]}
    >
      <Text variant="caption" tone={active ? "secondary" : "muted"}>
        {label}
      </Text>
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
  wash: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: alpha(tokens.accent.default, 0.07),
  },
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
  // Sits in the page gutter, left of the row.
  handle: {
    position: "absolute",
    left: -layout.gutter,
    top: 0,
    bottom: 0,
    width: layout.gutter,
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
    // The ring is the control's edge: `border.control` clears 3:1 on canvas.
    borderColor: tokens.border.control,
    alignItems: "center",
    justifyContent: "center",
  },
  checkCircleHover: { borderColor: tokens.text.secondary },
  checkCircleOn: { backgroundColor: tokens.border.control, borderColor: tokens.border.control },
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
  coverPlaceholderGlyph: {
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.lineHeight.xl,
    opacity: 0.55,
  },
  rowBody: { flex: 1, minWidth: 0, gap: tokens.space.xxs },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  rowTitle: {
    flexShrink: 1,
    color: tokens.text.primary,
    fontWeight: tokens.font.weight.medium,
    letterSpacing: tokens.font.tracking.heading,
  },
  rowTitleCompleted: { textDecorationLine: "line-through", color: tokens.text.muted },
  // 44pt target; the negative margin keeps the old 32pt visual footprint.
  menuBtn: { marginHorizontal: -tokens.space.xsm, borderRadius: tokens.radius.sm },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingTop: layout.sectionTop,
    paddingBottom: layout.sectionBottom,
  },
  // Under the toolbar, not under rows: the list's own top padding is enough.
  sectionHeaderFirst: { paddingTop: tokens.space.sm },
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
  sectionHeaderPressable: {
    minHeight: tokens.hit,
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
  dropZoneFirst: { marginTop: tokens.space.sm },
  dropZoneActive: {
    borderColor: tokens.accent.default,
    backgroundColor: alpha(tokens.accent.default, 0.08),
  },
});
