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
// Both drag stacks compose this inside their own drag-aware wrappers. On
// native the whole card is the reorder handle: the cover, title, Play, paste
// and standings Pressables each take `onLongPressBody`, and the wrapper
// catches a long-press on the gaps between them — only the kebab menu opts out
// (a press there opens the menu instead of starting a drag). Web drags via the
// wrapper's pointer listeners. A short tap on any control still runs that
// control's own action.

import { type ScoreReactionSummary, STREAK_MIN_DAYS } from "@workshop/shared/games";
import { Avatar, Text, tokens } from "@workshop/ui";
import { memo } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { ScoreReactions } from "./ScoreReactions";

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
  /** Emoji reactions on this score (Games surface only). Undefined → none rendered. */
  reactions?: ScoreReactionSummary[];
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
   * The viewer's consecutive-day play streak for this game (0 = none). Once it
   * reaches `STREAK_MIN_DAYS` a flame badge shows next to the title — a "play
   * today to keep your streak" CTA. Tapping it plays the game (calls `onPlay`),
   * so it stays useful whether or not today's already logged.
   */
  streak?: number;
  /**
   * Players with a score for the displayed day, in server display order
   * (rank-sorted, rankless rows last) — rendered as-is.
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
  /**
   * Long-press to reorder (native only; web drags via the wrapper). Wired onto
   * the cover, title, Play, paste and standings rows so the whole card is a
   * drag handle; the kebab menu deliberately omits it.
   */
  onLongPressBody?: () => void;
  onMenu: () => void;
  /** Open the game externally + arm the paste-on-return prompt. */
  onPlay: () => void;
  /** Manual paste fallback — opens the paste sheet without leaving the page. */
  onPaste: () => void;
  /**
   * Tap an existing reaction chip on a friend's row (Games surface only). When
   * omitted, chips render but aren't interactive.
   */
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  /**
   * Open the reaction picker for a friend's row. When omitted, no add
   * affordance shows (and the whole reaction row is hidden on rows with no
   * reactions) — this is what keeps the Lists surface reaction-free.
   */
  onOpenReactionPicker?: (userId: string) => void;
}

export const StandingsCard = memo(function StandingsCard({
  cardId,
  title,
  coverImageUrl,
  coverGlyph,
  accent,
  isDragging,
  turnout,
  streak,
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
  onReact,
  onOpenReactionPicker,
}: StandingsCardProps) {
  const scored = rows;
  const playedCount = scored.length;
  const showStreak = (streak ?? 0) >= STREAK_MIN_DAYS;

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
          onLongPress={onLongPressBody}
          delayLongPress={250}
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
          <View style={styles.titleRow}>
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
            {showStreak ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${streak} day streak — play ${title} today to keep it going`}
                onPress={onPlay}
                onLongPress={onLongPressBody}
                delayLongPress={250}
                hitSlop={6}
                testID={`game-card-streak-${cardId}`}
                style={({ pressed, hovered }) => [
                  styles.streak,
                  (pressed || hovered) && styles.streakHover,
                ]}
              >
                <Text style={styles.streakFlame}>🔥</Text>
                <Text style={styles.streakCount}>{streak}</Text>
                <Text style={styles.streakLabel}>day streak</Text>
              </Pressable>
            ) : null}
          </View>
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
                  onLongPress={onLongPressBody}
                  delayLongPress={250}
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
            onLongPress={onLongPressBody}
            delayLongPress={250}
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
          header row tall. Each score line is its own tap/long-press target
          (open detail / reorder on native) so the reaction controls beneath it
          aren't nested inside a button — that both avoids invalid DOM on web
          and keeps a reaction tap from bubbling into "open game". */}
      {loading ? (
        <SkeletonRows />
      ) : emptyShown ? (
        emptyFaces.length > 0 ? (
          <EmptyFacepile faces={emptyFaces} />
        ) : null
      ) : (
        <View style={styles.standings}>
          {topRows.map((row) => (
            <PlayerRow
              key={row.userId}
              row={row}
              isMe={row.userId === selfId}
              onPressBody={onPressBody}
              onLongPressBody={onLongPressBody}
              onReact={onReact}
              onOpenReactionPicker={onOpenReactionPicker}
            />
          ))}
          {pinnedSelf ? (
            <>
              <View style={styles.pinnedDivider} />
              <PlayerRow
                row={pinnedSelf}
                isMe
                onPressBody={onPressBody}
                onLongPressBody={onLongPressBody}
                onReact={onReact}
                onOpenReactionPicker={onOpenReactionPicker}
              />
            </>
          ) : null}
          {overflow > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${title} leaderboard`}
              onPress={onPressBody}
              onLongPress={onLongPressBody}
              delayLongPress={250}
            >
              <Text variant="caption" tone="muted" style={styles.moreLine}>
                +{overflow} more
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
});

interface PlayerRowProps {
  row: StandingsRow;
  isMe: boolean;
  onPressBody?: () => void;
  onLongPressBody?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

function PlayerRow({
  row,
  isMe,
  onPressBody,
  onLongPressBody,
  onReact,
  onOpenReactionPicker,
}: PlayerRowProps) {
  const name = row.displayName ?? "Someone";
  const reactions = row.reactions ?? [];
  // The viewer reacts to friends' scores, never their own — so the add
  // affordance + chip toggles are wired only on other people's rows. The
  // viewer's own row still shows reactions others left, read-only.
  const canReact = !isMe && !!onOpenReactionPicker;
  const showReactions = reactions.length > 0 || canReact;
  // Names are dropped from the row to save vertical space — the score sits
  // inline next to the avatar so each player is one line, not two. Identity
  // rides on the avatar circle; the full name stays in the accessibility
  // label so screen readers still announce who's who.
  return (
    <View
      style={[styles.playerRow, isMe && styles.playerRowMe]}
      testID={`game-card-row-${row.userId}`}
    >
      <Pressable
        style={styles.playerLine}
        accessibilityRole="button"
        accessibilityLabel={`${name}${isMe ? " (you)" : ""}: ${row.body ?? "played"}`}
        onPress={onPressBody}
        onLongPress={onLongPressBody}
        delayLongPress={250}
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
      </Pressable>
      {showReactions ? (
        <View style={styles.reactionsWrap}>
          <ScoreReactions
            reactions={reactions}
            testIDPrefix={`game-card-react-${row.userId}`}
            {...(canReact && onReact
              ? { onToggle: (emoji, cur) => onReact(row.userId, emoji, cur) }
              : {})}
            {...(canReact && onOpenReactionPicker
              ? { onAdd: () => onOpenReactionPicker(row.userId) }
              : {})}
          />
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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
  },
  titlePress: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  bodyPressed: { backgroundColor: tokens.bg.elevated },
  title: { fontSize: tokens.font.size.md, lineHeight: 21, letterSpacing: 0 },
  // The streak flame mirrors the Play pill's warm CTA treatment (amber-muted
  // fill, accent count) so it reads as "tap to keep your run going", not decor.
  streak: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.accent.muted,
  },
  streakHover: { backgroundColor: `${tokens.accent.default}33` },
  // Emoji/glyph styles pin an explicit lineHeight ≥ fontSize — iOS clips a
  // glyph to the inherited (22px body) line box otherwise (see app CLAUDE.md).
  streakFlame: { fontSize: 12, lineHeight: 16 },
  streakCount: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.bold,
    color: tokens.accent.default,
    fontVariant: ["tabular-nums"],
  },
  // The unit lives next to the bold count: "🔥 4 day streak". Lighter weight
  // than the number so the count stays the focal point; same accent + lineHeight.
  streakLabel: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.medium,
    color: tokens.accent.default,
  },
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
  playerLine: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  // Reactions ride to the right of the score on the same line — no extra row
  // height. They keep their natural width; the score line flexes to fill.
  reactionsWrap: { flexShrink: 0 },
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
