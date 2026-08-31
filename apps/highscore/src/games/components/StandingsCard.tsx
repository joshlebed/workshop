// Presentational leaderboard section — one per game on the Games home.
//
// v3 "Scoreboard": each game is a classic arcade hi-score table. Rank column
// in Press Start 2P, score numerals in Press Start 2P right-aligned so the
// column reads like an attract-mode standings screen, grid-like 2px row
// dividers instead of card-per-row chrome. The leader (#1) row is spotlit in
// neon yellow with an accent glow; the viewer's own row is marked in pink.
// Streaks celebrate in chartreuse.
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
import { Image, Pressable, StyleSheet, View } from "react-native";
import { bezel, colors, font, glow, PixelIcon, radius, space, Text } from "../../theme";
import { ScoreReactions } from "./ScoreReactions";

const TOP_N = 5;
const RANK_SLOT = 24;
const AVATAR_SM = 24;
const COVER = 36;
// The score block aligns under the player's name: rank slot + gap + avatar + gap.
const SCORE_INDENT = RANK_SLOT + space.sm + AVATAR_SM + space.sm;

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
  /** Surface accent — tints the cover placeholder only. */
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
   * reactions).
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
                <PixelIcon name="fire" size={16} color={colors.success} />
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
                  <Text variant="caption" style={styles.pasteLinkText}>
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
            <Text style={styles.playLabel}>PLAY</Text>
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
          <PixelIcon name="moreHorizontal" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Standings — the hi-score table. Only when there's something to show;
          the turnout line already carries the nobody-played story, so an empty
          game stays one header row tall. Each score line is its own
          tap/long-press target (open detail / reorder on native) so the
          reaction controls beneath it aren't nested inside a button. */}
      {loading ? (
        <SkeletonRows />
      ) : emptyShown ? (
        emptyFaces.length > 0 ? (
          <EmptyFacepile faces={emptyFaces} />
        ) : null
      ) : (
        <View style={styles.standings}>
          {topRows.map((row, i) => (
            <PlayerRow
              key={row.userId}
              row={row}
              isMe={row.userId === selfId}
              isFirstLine={i === 0}
              onPressBody={onPressBody}
              onLongPressBody={onLongPressBody}
              onReact={onReact}
              onOpenReactionPicker={onOpenReactionPicker}
            />
          ))}
          {pinnedSelf ? (
            <PlayerRow
              row={pinnedSelf}
              isMe
              isFirstLine={false}
              onPressBody={onPressBody}
              onLongPressBody={onLongPressBody}
              onReact={onReact}
              onOpenReactionPicker={onOpenReactionPicker}
            />
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
  /** First rendered line of the table — no divider above it. */
  isFirstLine: boolean;
  onPressBody?: () => void;
  onLongPressBody?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

function PlayerRow({
  row,
  isMe,
  isFirstLine,
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
  const isLeader = row.rank === 1;
  // Names are dropped from the row to save vertical space — identity rides on
  // the avatar; the full name stays in the accessibility label. The score is
  // the hero: right-aligned Press Start 2P numerals in a monospace column,
  // spotlit yellow on the leader row, marked pink on the viewer's own row.
  return (
    <View
      style={[styles.playerRow, !isFirstLine && styles.playerRowDivider]}
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
        {isMe ? <Text style={styles.youMark}>YOU</Text> : null}
        <Text
          style={[
            styles.scoreBody,
            isLeader && styles.scoreBodyLeader,
            isMe && !isLeader && styles.scoreBodyMe,
            row.body ? null : styles.scoreBodyMuted,
          ]}
          testID={`game-card-score-${row.userId}`}
        >
          {row.body ?? "PLAYED"}
        </Text>
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
    // The one spotlight: neon-yellow #1 with an accent glow (DESIGN.md —
    // yellow marks what to look at, and rank moments are glow-eligible).
    return (
      <View style={styles.rankSlot}>
        <Text style={[styles.rankText, styles.rankFirstText]}>1</Text>
      </View>
    );
  }
  return (
    <View style={styles.rankSlot}>
      <Text style={styles.rankText}>{rank}</Text>
    </View>
  );
}

// Dimmed roster so "nobody played" still shows who could. The Games home
// passes no faces and the section stays one row.
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
  // A scoreboard section sitting on the canvas: 2px grid rule below, no boxed
  // chrome. The slight horizontal bleed gives hover/drag backgrounds room
  // without shifting content off the column grid.
  card: {
    paddingVertical: space.md,
    paddingHorizontal: space.sm,
    marginHorizontal: -space.sm,
    gap: space.sm,
    borderBottomWidth: bezel,
    borderBottomColor: colors.border,
  },
  cardDragging: {
    backgroundColor: colors.surface2,
    borderWidth: bezel,
    borderColor: colors.border,
    borderBottomColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
  },
  cover: { borderRadius: radius.soft },
  coverPressed: { opacity: 0.7 },
  coverImage: {
    width: COVER,
    height: COVER,
    borderRadius: radius.soft,
    backgroundColor: colors.surface2,
  },
  coverPlaceholder: { alignItems: "center", justifyContent: "center" },
  coverGlyph: { fontSize: 18 },
  headerText: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  titlePress: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    paddingHorizontal: space.xs,
    marginHorizontal: -space.xs,
  },
  bodyPressed: { backgroundColor: colors.surface2 },
  // Game titles are section headings → pixel face, sized down to fit a row.
  title: { fontSize: 11, lineHeight: 18 },
  // Streaks celebrate in chartreuse (DESIGN.md: success = streaks/wins).
  streak: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.success,
    backgroundColor: "transparent",
  },
  streakHover: { backgroundColor: `${colors.success}1A` },
  streakCount: {
    fontFamily: font.pixel,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1,
    color: colors.success,
  },
  streakLabel: {
    fontSize: font.size.xs,
    lineHeight: 16,
    fontWeight: font.weight.medium,
    color: colors.success,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginTop: 1,
  },
  turnout: { flexShrink: 1, letterSpacing: 0 },
  pasteLink: {},
  pasteLinkHover: { backgroundColor: colors.surface2 },
  pasteLinkText: { textDecorationLine: "underline", color: colors.primaryTint },
  // Pink is the one interactive color: PLAY is a bezeled pink text button.
  playPill: {
    paddingHorizontal: space.md,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: "transparent",
  },
  playPillHover: { backgroundColor: `${colors.primary}1A` },
  playLabel: {
    color: colors.primary,
    fontFamily: font.pixel,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1,
  },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBtnHover: { backgroundColor: colors.surface2 },
  // Grid-like table: rows separated by 2px rules, no per-row chrome.
  standings: { gap: 0 },
  playerRow: {
    paddingVertical: 6,
    paddingHorizontal: space.xs,
    marginHorizontal: -space.xs,
  },
  playerRowDivider: {
    borderTopWidth: bezel,
    borderTopColor: colors.surface2,
  },
  playerLine: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  // Reactions ride below the score line, right-aligned with the table.
  reactionsWrap: { alignSelf: "flex-end", flexShrink: 0, paddingTop: 2 },
  rankSlot: {
    width: RANK_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    color: colors.textSecondary,
    fontFamily: font.pixel,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1,
  },
  rankDot: { color: colors.textSecondary, fontSize: font.size.md, lineHeight: 16 },
  rankFirstText: {
    color: colors.accent,
    textShadowColor: colors.accentGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  youMark: {
    fontFamily: font.pixel,
    fontSize: 8,
    lineHeight: 13,
    letterSpacing: 1,
    color: colors.primary,
  },
  // The score column: right-aligned pixel numerals (Press Start 2P is
  // effectively monospace, so columns of scores align across rows).
  scoreBody: {
    flex: 1,
    textAlign: "right",
    color: colors.textPrimary,
    fontFamily: font.pixel,
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1,
  },
  scoreBodyLeader: {
    color: colors.accent,
    textShadowColor: colors.accentGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  scoreBodyMe: { color: colors.primaryTint },
  scoreBodyMuted: { color: colors.textSecondary },
  moreLine: {
    paddingLeft: SCORE_INDENT,
    paddingTop: 4,
  },
  facepile: { flexDirection: "row", paddingLeft: COVER + space.md },
  faceWrap: {
    borderWidth: 2,
    borderColor: colors.bg,
    borderRadius: 999,
    opacity: 0.45,
  },
  faceOverlap: { marginLeft: -10 },
  skeletonWrap: { gap: space.sm },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  skeletonDot: {
    width: AVATAR_SM,
    height: AVATAR_SM,
    borderRadius: AVATAR_SM / 2,
    backgroundColor: colors.surface2,
  },
  skeletonBar: {
    height: 10,
    backgroundColor: colors.surface2,
  },
});
