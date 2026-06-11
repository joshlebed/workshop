// Presentational leaderboard section — one per game, shared between the
// Lists surface (leaderboard lists render it via `GameLeaderboardCard`) and
// the Games tab home (one section per game in My Games).
//
// Not a boxed card: each game is a compact ledger section sitting directly on
// the canvas, separated by a hairline rule. A game nobody has played collapses
// to a single header row; standings rows give a game height only when there's
// activity. While dragging, the section lifts into an elevated chip.
//
// Pure presentation: rows arrive pre-distilled (the caller runs each player's
// raw result through the `scoresSummary` distiller) and surface-specific copy
// (turnout line, CTA visibility) is computed at the call site. What lives
// here is the standings rendering itself: rank marks, top-N cut with a pinned
// "you" row, the dimmed empty facepile, skeletons, and the Play / paste
// affordances.
//
// Both drag stacks compose this inside their own drag-aware wrappers:
// long-press the title or standings to reorder on native (`onLongPressBody`);
// web drags via the wrapper's pointer listeners. The cover, menu, Play and
// paste controls are their own Pressables so a tap on them never starts a
// drag or a body-tap.

import { memo } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { Avatar, Text, tokens } from "../ui/index";

const TOP_N = 5;
const RANK_SLOT = 20;
const AVATAR_SM = 24;
const COVER = 36;
// The score block aligns under the player's name: rank slot + gap + avatar + gap.
const SCORE_INDENT = RANK_SLOT + tokens.space.sm + AVATAR_SM + tokens.space.sm;

/** One scored player. `body` is the distilled score block; null → "Played". */
export interface StandingsRow {
  userId: string;
  displayName: string | null;
  avatarUrl?: string | null;
  /** Standard competition rank (1, 2, 2, 4); null when no numeric score. */
  rank: number | null;
  body: string | null;
}

export interface StandingsFace {
  userId: string;
  displayName: string | null;
  avatarUrl?: string | null;
}

export interface StandingsCardProps {
  /** Stable id for testIDs (`game-card-${cardId}` etc.). */
  cardId: string;
  title: string;
  coverImageUrl: string | null;
  coverGlyph: string;
  /** Surface accent — tints the cover placeholder only (identity, per DESIGN.md). */
  accent: string;
  isDragging: boolean;
  /** One-line social signal under the title ("3 of 5 played today"). */
  turnout: string;
  /**
   * Players with a score for the displayed day, any order — sorted by rank
   * here so the standings read top-down (rankless rows sort last).
   */
  rows: StandingsRow[];
  selfId: string | null;
  /** Scores still loading — show skeleton standings, not an empty section. */
  loading?: boolean;
  /** Dimmed facepile shown when nobody has played (may be empty). */
  emptyFaces: StandingsFace[];
  /** Show the Play pill / paste link (caller gates on "viewer hasn't played today"). */
  showCta: boolean;
  /** Tap the title or standings → detail. */
  onPressBody?: () => void;
  /** Long-press the body → reorder (native only; web drags via the wrapper). */
  onLongPressBody?: () => void;
  onMenu: () => void;
  /** Open the game externally + arm the paste-on-return prompt. */
  onPlay: () => void;
  /** Manual paste fallback — opens the paste sheet without leaving the page. */
  onPaste: () => void;
}

// Sort by server rank; rows that played but carry no parseable rank sort last.
function byRank(a: StandingsRow, b: StandingsRow): number {
  if (a.rank == null && b.rank == null) return 0;
  if (a.rank == null) return 1;
  if (b.rank == null) return -1;
  return a.rank - b.rank;
}

export const StandingsCard = memo(function StandingsCard({
  cardId,
  title,
  coverImageUrl,
  coverGlyph,
  accent,
  isDragging,
  turnout,
  rows,
  selfId,
  loading,
  emptyFaces,
  showCta,
  onPressBody,
  onLongPressBody,
  onMenu,
  onPlay,
  onPaste,
}: StandingsCardProps) {
  const scored = [...rows].sort(byRank);
  const playedCount = scored.length;

  const myRow = selfId ? scored.find((r) => r.userId === selfId) : undefined;

  // Top N by server rank, plus a pinned "you" row when the viewer played but
  // ranks outside the cut — the common leaderboard courtesy of always showing
  // people their own standing.
  const topRows = scored.slice(0, TOP_N);
  const selfInTop = selfId ? topRows.some((r) => r.userId === selfId) : false;
  const pinnedSelf = !selfInTop && myRow ? myRow : undefined;
  const overflow = scored.slice(TOP_N).filter((r) => r.userId !== selfId).length;

  const ctaVisible = showCta && !loading;
  const emptyShown = !loading && playedCount === 0;

  return (
    <View style={[styles.card, isDragging && styles.cardDragging]} testID={`game-card-${cardId}`}>
      {/* Header: cover opens the game; the title taps through to detail. */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Play ${title}`}
          onPress={onPlay}
          hitSlop={6}
          testID={`game-card-cover-${cardId}`}
          style={({ pressed }) => [styles.cover, pressed && styles.coverPressed]}
        >
          {coverImageUrl ? (
            <Image
              source={{ uri: coverImageUrl }}
              style={styles.coverImage}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View
              style={[
                styles.coverImage,
                styles.coverPlaceholder,
                { backgroundColor: `${accent}1F` },
              ]}
            >
              <Text style={styles.coverGlyph}>{coverGlyph}</Text>
            </View>
          )}
        </Pressable>

        <View style={styles.headerText}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${title} leaderboard`}
            onPress={onPressBody}
            onLongPress={onLongPressBody}
            delayLongPress={250}
            hitSlop={{ top: 6, bottom: 2 }}
            testID={`game-card-body-${cardId}`}
            style={({ pressed, hovered }) => [
              styles.titlePress,
              (pressed || hovered) && styles.bodyPressed,
            ]}
          >
            <Text variant="heading" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          </Pressable>
          <View style={styles.metaRow}>
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.turnout}>
              {turnout}
            </Text>
            {ctaVisible ? (
              <>
                <Text variant="caption" tone="muted">
                  ·
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Paste your ${title} result`}
                  onPress={onPaste}
                  hitSlop={8}
                  testID={`game-card-paste-${cardId}`}
                  style={({ pressed, hovered }) => [
                    styles.pasteLink,
                    (pressed || hovered) && styles.pasteLinkHover,
                  ]}
                >
                  <Text variant="caption" tone="muted" style={styles.pasteLinkText}>
                    paste
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>

        {ctaVisible ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Play ${title}`}
            onPress={onPlay}
            hitSlop={8}
            testID={`game-card-play-${cardId}`}
            style={({ pressed, hovered }) => [
              styles.playPill,
              (pressed || hovered) && styles.playPillHover,
            ]}
          >
            <Text style={styles.playLabel}>Play</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open menu for ${title}`}
          onPress={onMenu}
          hitSlop={10}
          testID={`game-card-menu-${cardId}`}
          style={({ pressed, hovered }) => [
            styles.menuBtn,
            (pressed || hovered) && styles.menuBtnHover,
          ]}
        >
          <Text style={styles.menuGlyph}>⋯</Text>
        </Pressable>
      </View>

      {/* Standings — only when there's something to show. The turnout line
          already carries the nobody-played story; an empty game stays one
          header row tall. Long-press here also activates reorder on native. */}
      {loading ? (
        <SkeletonRows />
      ) : emptyShown ? (
        emptyFaces.length > 0 ? (
          <EmptyFacepile faces={emptyFaces} />
        ) : null
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}: ${turnout}`}
          onPress={onPressBody}
          onLongPress={onLongPressBody}
          delayLongPress={250}
          style={styles.standings}
        >
          {topRows.map((row) => (
            <PlayerRow key={row.userId} row={row} isMe={row.userId === selfId} />
          ))}
          {pinnedSelf ? (
            <>
              <View style={styles.pinnedDivider} />
              <PlayerRow row={pinnedSelf} isMe />
            </>
          ) : null}
          {overflow > 0 ? (
            <Text variant="caption" tone="muted" style={styles.moreLine}>
              +{overflow} more
            </Text>
          ) : null}
        </Pressable>
      )}
    </View>
  );
});

interface PlayerRowProps {
  row: StandingsRow;
  isMe: boolean;
}

function PlayerRow({ row, isMe }: PlayerRowProps) {
  const name = row.displayName ?? "Someone";
  // Names are dropped from the row to save vertical space — the score sits
  // inline next to the avatar so each player is one line, not two. Identity
  // rides on the avatar circle; the full name stays in the accessibility
  // label so screen readers still announce who's who.
  return (
    <View
      style={[styles.playerRow, isMe && styles.playerRowMe]}
      testID={`game-card-row-${row.userId}`}
      accessible
      accessibilityLabel={`${name}${isMe ? " (you)" : ""}: ${row.body ?? "played"}`}
    >
      <RankMark rank={row.rank} />
      <Avatar name={row.displayName} imageUrl={row.avatarUrl} size="sm" />
      <Text
        style={[styles.scoreBody, row.body ? null : styles.scoreBodyMuted]}
        testID={`game-card-score-${row.userId}`}
      >
        {row.body ?? "Played"}
      </Text>
      {isMe ? (
        <View style={styles.youPill}>
          <Text style={styles.youPillText}>you</Text>
        </View>
      ) : null}
    </View>
  );
}

function RankMark({ rank }: { rank: number | null }) {
  if (rank == null) {
    return (
      <View style={styles.rankSlot}>
        <Text style={styles.rankDot}>·</Text>
      </View>
    );
  }
  if (rank === 1) {
    return (
      <View style={[styles.rankSlot, styles.rankFirst]}>
        <Text style={styles.rankFirstText}>1</Text>
      </View>
    );
  }
  return (
    <View style={styles.rankSlot}>
      <Text style={styles.rankText}>{rank}</Text>
    </View>
  );
}

// Lists surface: the member roster, dimmed, so "nobody played" still shows
// who could. The Games home passes no faces and the section stays one row.
function EmptyFacepile({ faces }: { faces: StandingsFace[] }) {
  const shown = faces.slice(0, 5);
  return (
    <View style={styles.facepile}>
      {shown.map((m, i) => (
        <View key={m.userId} style={[styles.faceWrap, i > 0 && styles.faceOverlap]}>
          <Avatar name={m.displayName} imageUrl={m.avatarUrl} size="sm" />
        </View>
      ))}
    </View>
  );
}

function SkeletonRows() {
  return (
    <View style={styles.skeletonWrap} accessibilityElementsHidden importantForAccessibility="no">
      {[0, 1].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={styles.skeletonDot} />
          <View style={[styles.skeletonBar, { width: i === 0 ? "44%" : "32%" }]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // A ledger section, not a box: hairline rule below, breathing room inside.
  // The slight horizontal bleed gives hover/drag backgrounds room without
  // shifting content off the column grid.
  card: {
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.sm,
    marginHorizontal: -tokens.space.sm,
    gap: tokens.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
  },
  cardDragging: {
    backgroundColor: tokens.bg.elevated,
    borderRadius: tokens.radius.lg,
    borderBottomColor: "transparent",
    boxShadow: "0px 8px 18px rgba(0, 0, 0, 0.4)",
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  cover: { borderRadius: tokens.radius.sm },
  coverPressed: { opacity: 0.7 },
  coverImage: {
    width: COVER,
    height: COVER,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverGlyph: { fontSize: 18 },
  headerText: { flex: 1, minWidth: 0 },
  titlePress: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  bodyPressed: { backgroundColor: tokens.bg.elevated },
  title: { fontSize: tokens.font.size.md, lineHeight: 21, letterSpacing: 0 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    marginTop: 1,
  },
  turnout: { flexShrink: 1, letterSpacing: 0 },
  pasteLink: { borderRadius: tokens.radius.sm },
  pasteLinkHover: { backgroundColor: tokens.bg.elevated },
  pasteLinkText: { textDecorationLine: "underline" },
  playPill: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: 6,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.accent.muted,
  },
  playPillHover: { backgroundColor: `${tokens.accent.default}33` },
  playLabel: {
    color: tokens.accent.default,
    fontSize: tokens.font.size.sm,
    lineHeight: 18,
    fontWeight: tokens.font.weight.semibold,
  },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  menuBtnHover: { backgroundColor: tokens.bg.elevated },
  menuGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.lg,
    lineHeight: tokens.font.size.lg,
  },
  standings: { gap: tokens.space.sm },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: 4,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  playerRowMe: { backgroundColor: `${tokens.accent.default}14` },
  rankSlot: {
    width: RANK_SLOT,
    height: RANK_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    fontVariant: ["tabular-nums"],
  },
  rankDot: { color: tokens.text.muted, fontSize: tokens.font.size.md },
  rankFirst: {
    borderRadius: RANK_SLOT / 2,
    backgroundColor: tokens.accent.default,
  },
  rankFirstText: {
    color: tokens.text.onAccent,
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.bold,
    fontVariant: ["tabular-nums"],
  },
  youPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.accent.muted,
  },
  youPillText: {
    fontSize: 10,
    fontWeight: tokens.font.weight.semibold,
    letterSpacing: 0.5,
    color: tokens.accent.default,
    textTransform: "uppercase",
  },
  scoreBody: {
    flex: 1,
    color: tokens.text.secondary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 5,
  },
  scoreBodyMuted: { color: tokens.text.muted, fontStyle: "italic" },
  pinnedDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginVertical: tokens.space.xs,
    marginLeft: SCORE_INDENT,
  },
  moreLine: {
    paddingLeft: SCORE_INDENT,
    paddingTop: 2,
  },
  facepile: { flexDirection: "row", paddingLeft: COVER + tokens.space.md },
  faceWrap: {
    borderWidth: 2,
    borderColor: tokens.bg.canvas,
    borderRadius: 999,
    opacity: 0.45,
  },
  faceOverlap: { marginLeft: -10 },
  skeletonWrap: { gap: tokens.space.sm },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  skeletonDot: {
    width: AVATAR_SM,
    height: AVATAR_SM,
    borderRadius: AVATAR_SM / 2,
    backgroundColor: tokens.bg.elevated,
  },
  skeletonBar: {
    height: 10,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.bg.elevated,
  },
});
