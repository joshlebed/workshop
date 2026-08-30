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
import { Avatar } from "@workshop/ui";
import { memo } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import {
  HsText,
  hsBezel,
  hsColor,
  hsSpace,
  PixelCorners,
  PixelDivider,
  PixelIcon,
} from "../../theme";
import { ScoreReactions } from "./ScoreReactions";

const TOP_N = 5;
const RANK_SLOT = 20;
const AVATAR_SM = 24;
const COVER = 36;
const hsFontSm = 13;
// The score block aligns under the player's name: rank slot + gap + avatar + gap.
const SCORE_INDENT = RANK_SLOT + hsSpace.sm + AVATAR_SM + hsSpace.sm;

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
      {/* v4 hero-card construction: one-pixel-step cut corners over the bezel. */}
      <PixelCorners
        cutColor={hsColor.bg}
        bezelColor={isDragging ? hsColor.primary : hsColor.border}
      />
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
              <HsText style={styles.coverGlyph}>{coverGlyph}</HsText>
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
              <HsText variant="pixelLabel" numberOfLines={1} style={styles.title}>
                {title}
              </HsText>
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
                <PixelIcon name="fire" size={16} color={hsColor.success} />
                <HsText variant="pixelLabel" tone="success" style={styles.streakCount}>
                  {streak}
                </HsText>
                <HsText variant="caption" tone="success" style={styles.streakLabel}>
                  day streak
                </HsText>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <HsText variant="caption" tone="secondary" numberOfLines={1} style={styles.turnout}>
              {turnout}
            </HsText>
            {ctaVisible ? (
              <>
                <HsText variant="caption" tone="secondary">
                  ·
                </HsText>
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
                  <HsText variant="caption" tone="pinkTint" style={styles.pasteLinkText}>
                    paste
                  </HsText>
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
            <HsText variant="pixelLabel" tone="onNeon" style={styles.playLabel}>
              Play
            </HsText>
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
          <PixelIcon name="more-horizontal" size={16} color={hsColor.textSecondary} />
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
              <PixelDivider style={styles.pinnedDivider} />
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
              <HsText variant="caption" tone="secondary" style={styles.moreLine}>
                +{overflow} more
              </HsText>
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
        <HsText
          style={[styles.scoreBody, row.body ? null : styles.scoreBodyMuted]}
          testID={`game-card-score-${row.userId}`}
        >
          {row.body ?? "Played"}
        </HsText>
        {isMe ? (
          <View style={styles.youPill}>
            <HsText variant="pixelLabel" tone="pink" style={styles.youPillText}>
              you
            </HsText>
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
        <HsText style={styles.rankDot}>·</HsText>
      </View>
    );
  }
  if (rank === 1) {
    // Spotlight: the leader gets the neon-yellow pixel badge (accent marks
    // what to look at — never what to tap).
    return (
      <View style={[styles.rankSlot, styles.rankFirst]}>
        <HsText variant="pixelLabel" tone="onNeon" style={styles.rankFirstText}>
          1
        </HsText>
      </View>
    );
  }
  return (
    <View style={styles.rankSlot}>
      <HsText variant="pixelLabel" tone="secondary" style={styles.rankText}>
        {rank}
      </HsText>
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
  // v4 hero card: purple surface, chunky 2px bezel, notched corners (the
  // PixelCorners overlay in render). Sharp everywhere — no radius, no soft
  // shadows; elevation while dragging = surface step + pink bezel.
  card: {
    paddingVertical: hsSpace.md,
    paddingHorizontal: hsSpace.md,
    marginBottom: hsSpace.md,
    gap: hsSpace.sm,
    backgroundColor: hsColor.surface1,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
  },
  cardDragging: {
    backgroundColor: hsColor.surface3,
    borderColor: hsColor.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.md,
  },
  cover: { borderRadius: 0 },
  coverPressed: { opacity: 0.7 },
  coverImage: {
    width: COVER,
    height: COVER,
    borderRadius: 0,
    backgroundColor: hsColor.surface2,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverGlyph: { fontSize: 18, lineHeight: 24 },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.xs,
  },
  titlePress: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    paddingHorizontal: hsSpace.xs,
    marginHorizontal: -hsSpace.xs,
  },
  bodyPressed: { backgroundColor: hsColor.surface2 },
  // Slightly oversized pixel heading for the game title (v4 latitude).
  title: { fontSize: 12, lineHeight: 19 },
  // Streak = celebration → chartreuse, and only chartreuse. Sharp chip.
  streak: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: `${hsColor.success}55`,
    backgroundColor: `${hsColor.success}14`,
  },
  streakHover: { backgroundColor: `${hsColor.success}26` },
  streakCount: { fontSize: 10, lineHeight: 16 },
  streakLabel: { fontSize: 11, lineHeight: 16 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.xs,
    marginTop: 2,
  },
  turnout: { flexShrink: 1, letterSpacing: 0 },
  pasteLink: { borderRadius: 0 },
  pasteLinkHover: { backgroundColor: hsColor.surface2 },
  pasteLinkText: { textDecorationLine: "underline" },
  // Pink is the one interactive color: Play is a small filled primary block.
  playPill: {
    paddingHorizontal: hsSpace.lg,
    paddingVertical: 8,
    borderRadius: 0,
    backgroundColor: hsColor.primary,
  },
  playPillHover: { backgroundColor: hsColor.primaryTint },
  playLabel: { fontSize: 10, lineHeight: 16 },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
  },
  menuBtnHover: { backgroundColor: hsColor.surface2 },
  standings: { gap: hsSpace.sm },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.sm,
    paddingVertical: 4,
    paddingHorizontal: hsSpace.xs,
    marginHorizontal: -hsSpace.xs,
  },
  playerLine: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.sm,
  },
  // Reactions ride to the right of the score on the same line — no extra row
  // height. They keep their natural width; the score line flexes to fill.
  reactionsWrap: { flexShrink: 0 },
  playerRowMe: { backgroundColor: `${hsColor.primary}14` },
  rankSlot: {
    width: RANK_SLOT,
    height: RANK_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: { fontSize: 10, lineHeight: 14 },
  rankDot: { color: hsColor.textSecondary, fontSize: 16 },
  // #1 = the spotlight: neon-yellow pixel badge, sharp square.
  rankFirst: { backgroundColor: hsColor.accent },
  rankFirstText: { fontSize: 10, lineHeight: 14 },
  youPill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: `${hsColor.primary}66`,
    backgroundColor: `${hsColor.primary}14`,
  },
  youPillText: { fontSize: 8, lineHeight: 11 },
  scoreBody: {
    flex: 1,
    color: hsColor.textSecondary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: hsFontSm,
    lineHeight: hsFontSm + 5,
  },
  scoreBodyMuted: { color: hsColor.textSecondary, fontStyle: "italic", opacity: 0.7 },
  pinnedDivider: {
    marginVertical: hsSpace.xs,
    marginLeft: SCORE_INDENT,
  },
  moreLine: {
    paddingLeft: SCORE_INDENT,
    paddingTop: 2,
  },
  facepile: { flexDirection: "row", paddingLeft: COVER + hsSpace.md },
  faceWrap: {
    borderWidth: 2,
    borderColor: hsColor.surface1,
    borderRadius: 999,
    opacity: 0.45,
  },
  faceOverlap: { marginLeft: -10 },
  skeletonWrap: { gap: hsSpace.sm },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: hsSpace.sm },
  skeletonDot: {
    width: AVATAR_SM,
    height: AVATAR_SM,
    borderRadius: 0,
    backgroundColor: hsColor.surface2,
  },
  skeletonBar: {
    height: 10,
    borderRadius: 0,
    backgroundColor: hsColor.surface2,
  },
});
