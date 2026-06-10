// Presentational leaderboard "status card" — one per game, shared between the
// Lists surface (leaderboard lists render it via `GameLeaderboardCard`) and
// the Games tab home (one card per game in My Games).
//
// Pure presentation: rows arrive pre-distilled (the caller runs each player's
// raw result through the `scoresSummary` distiller) and surface-specific copy
// (turnout line, empty text, CTA visibility) is computed at the call site.
// What lives here is the standings rendering itself: rank marks, top-N cut
// with a pinned "you" row, the dimmed empty facepile, skeletons, and the
// Play / paste CTA chrome.
//
// Both drag stacks compose this inside their own drag-aware wrappers:
// long-press the card body to reorder on native (`onLongPressBody`); web
// drags via the wrapper's pointer listeners. The cover, menu, Play and paste
// controls are their own Pressables so a tap on them never starts a drag or
// a body-tap.

import { memo } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { Avatar, Text, tokens } from "../ui/index";

const TOP_N = 5;
const RANK_SLOT = 20;
const AVATAR_SM = 24;
// The score block aligns under the player's name: rank slot + gap + avatar + gap.
const SCORE_INDENT = RANK_SLOT + tokens.space.sm + AVATAR_SM + tokens.space.sm;

/** One scored player. `body` is the distilled score block; null → "Played". */
export interface StandingsRow {
  userId: string;
  displayName: string | null;
  /** Standard competition rank (1, 2, 2, 4); null when no numeric score. */
  rank: number | null;
  body: string | null;
}

export interface StandingsFace {
  userId: string;
  displayName: string | null;
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
  /** Scores still loading — show skeleton standings, not an empty card. */
  loading?: boolean;
  /** Dimmed facepile shown when nobody has played (may be empty). */
  emptyFaces: StandingsFace[];
  /** Caption beside the empty facepile. */
  emptyText: string;
  /** Show the Play / paste CTA row (caller gates on "viewer hasn't played today"). */
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
  emptyText,
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

  return (
    <View style={[styles.card, isDragging && styles.cardDragging]} testID={`game-card-${cardId}`}>
      {/* Header: cover opens the game; the title block taps through to detail. */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Play ${title}`}
          onPress={onPlay}
          hitSlop={4}
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${title} leaderboard`}
          onPress={onPressBody}
          onLongPress={onLongPressBody}
          delayLongPress={250}
          testID={`game-card-body-${cardId}`}
          style={({ pressed, hovered }) => [
            styles.headerText,
            (pressed || hovered) && styles.bodyPressed,
          ]}
        >
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.turnout}>
            {turnout}
          </Text>
        </Pressable>

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

      {/* Standings — long-press here also activates reorder on native. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${turnout}`}
        onPress={onPressBody}
        onLongPress={onLongPressBody}
        delayLongPress={250}
        style={styles.standings}
      >
        {loading ? (
          <SkeletonRows />
        ) : playedCount === 0 ? (
          <EmptyStandings faces={emptyFaces} text={emptyText} />
        ) : (
          <>
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
          </>
        )}
      </Pressable>

      {/* Play CTA — only when the caller says the viewer can still log a
          result for the displayed day. */}
      {showCta && !loading ? (
        <View style={styles.cta}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Play ${title}`}
            onPress={onPlay}
            testID={`game-card-play-${cardId}`}
            style={({ pressed, hovered }) => [
              styles.playBtn,
              (pressed || hovered) && styles.playBtnHover,
            ]}
          >
            <Text style={styles.playGlyph}>▶</Text>
            <Text style={styles.playLabel} numberOfLines={1}>
              Play {title}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Paste your ${title} result`}
            onPress={onPaste}
            hitSlop={6}
            testID={`game-card-paste-${cardId}`}
            style={({ pressed, hovered }) => [
              styles.pasteLink,
              (pressed || hovered) && styles.pasteLinkHover,
            ]}
          >
            <Text variant="caption" tone="muted" style={styles.pasteLinkText}>
              or paste result
            </Text>
          </Pressable>
        </View>
      ) : null}
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
  // rides on the initials circle (+ its hashed color); the full name stays in
  // the accessibility label so screen readers still announce who's who.
  return (
    <View
      style={[styles.playerRow, isMe && styles.playerRowMe]}
      testID={`game-card-row-${row.userId}`}
      accessible
      accessibilityLabel={`${name}${isMe ? " (you)" : ""}: ${row.body ?? "played"}`}
    >
      <RankMark rank={row.rank} />
      <Avatar name={row.displayName} size="sm" />
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

function EmptyStandings({ faces, text }: { faces: StandingsFace[]; text: string }) {
  const shown = faces.slice(0, 5);
  return (
    <View style={styles.empty}>
      {shown.length > 0 ? (
        <View style={styles.facepile}>
          {shown.map((m, i) => (
            <View key={m.userId} style={[styles.faceWrap, i > 0 && styles.faceOverlap]}>
              <Avatar name={m.displayName} size="sm" />
            </View>
          ))}
        </View>
      ) : null}
      <Text variant="caption" tone="muted" style={styles.emptyText}>
        {text}
      </Text>
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
  card: {
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.space.md,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
    marginBottom: tokens.space.md,
    gap: tokens.space.sm,
  },
  cardDragging: {
    backgroundColor: tokens.bg.elevated,
    borderColor: tokens.border.default,
    boxShadow: "0px 8px 18px rgba(0, 0, 0, 0.4)",
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  cover: { borderRadius: tokens.radius.md },
  coverPressed: { opacity: 0.7 },
  coverImage: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverGlyph: { fontSize: 22 },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  bodyPressed: { backgroundColor: tokens.bg.elevated },
  title: { fontSize: tokens.font.size.md, letterSpacing: -0.1 },
  turnout: { letterSpacing: 0.1 },
  menuBtn: {
    width: 32,
    height: 32,
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
  standings: {
    gap: tokens.space.sm,
    paddingTop: tokens.space.xs,
  },
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
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingVertical: tokens.space.xs,
  },
  facepile: { flexDirection: "row" },
  faceWrap: {
    borderWidth: 2,
    borderColor: tokens.bg.surface,
    borderRadius: 999,
    opacity: 0.45,
  },
  faceOverlap: { marginLeft: -10 },
  emptyText: { flex: 1 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingTop: tokens.space.xs,
  },
  playBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.accent.muted,
    borderWidth: 1,
    borderColor: `${tokens.accent.default}55`,
  },
  playBtnHover: { backgroundColor: `${tokens.accent.default}33` },
  playGlyph: { color: tokens.accent.default, fontSize: 11 },
  playLabel: {
    color: tokens.accent.default,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    flexShrink: 1,
  },
  pasteLink: {
    paddingVertical: tokens.space.xs,
    paddingHorizontal: tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  pasteLinkHover: { backgroundColor: tokens.bg.elevated },
  pasteLinkText: { textDecorationLine: "underline" },
  skeletonWrap: { gap: tokens.space.sm, paddingVertical: tokens.space.xs },
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
