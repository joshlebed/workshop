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
// "you" row, the dimmed empty facepile, skeletons, and the Play affordance.
// There is no per-card paste: the home's bottom action bar is the only paste
// entry point (UX-DECISIONS entry 7); posting for a specific game lives on
// the per-game board.
//
// Both drag stacks compose this inside their own drag-aware wrappers. On
// native the whole card is the reorder handle: the cover, title, Play and
// standings Pressables each take `onLongPressBody`, and the wrapper
// catches a long-press on the gaps between them — only the kebab menu opts out
// (a press there opens the menu instead of starting a drag). Web drags via the
// wrapper's pointer listeners. A short tap on any control still runs that
// control's own action.

import { type ScoreReactionSummary, STREAK_MIN_DAYS } from "@workshop/shared/games";
import { REORDER_ACTIVATION } from "@workshop/ui";
import { memo } from "react";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { Avatar, bodyType, PixelIcon, scoreType, Text, tokens, uiType } from "../../theme";
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
  /** The player picked this score and the game's parser reads the text differently. */
  adjusted?: boolean;
  /** "Score: 80" / "Didn't finish" when the score is the player's own pick. */
  picked?: string;
  /** "Fix score" — set only on the viewer's own row that nothing could read. */
  onFix?: () => void;
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
  /** Show the Play pill (caller gates on "viewer hasn't played today"). */
  showCta: boolean;
  /**
   * Tap anywhere on the card → detail. The only parts that don't are the
   * Play triangle, the kebab menu, the reaction chips and the Fix link.
   */
  onPressBody?: () => void;
  /**
   * Long-press to reorder (native only; web drags via the wrapper). The whole
   * card is the drag handle.
   */
  onLongPressBody?: () => void;
  onMenu: () => void;
  /** Open the game externally + arm the paste-on-return prompt. */
  onPlay: () => void;
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

  // The card itself is the tap target for detail (and the native drag
  // handle). It carries no accessibilityRole so RN-Web renders a <div>, not a
  // <button> — the Play / menu / reaction / Fix controls inside are real
  // buttons and nested buttons are invalid DOM. The title row is the named,
  // focusable "open leaderboard" control for assistive tech.
  return (
    <Pressable
      onPress={onPressBody}
      onLongPress={onLongPressBody}
      delayLongPress={REORDER_ACTIVATION.longPressMs}
      style={({ pressed, hovered }) => [
        styles.card,
        (pressed || hovered) && styles.cardHover,
        isDragging && styles.cardDragging,
      ]}
      testID={`game-card-${cardId}`}
    >
      <View style={styles.header}>
        <View style={styles.cover} testID={`game-card-cover-${cardId}`}>
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
        </View>

        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <View
              accessibilityRole="button"
              accessibilityLabel={`Open ${title} leaderboard`}
              testID={`game-card-body-${cardId}`}
              style={styles.titlePress}
            >
              <Text variant="game" numberOfLines={1}>
                {title}
              </Text>
            </View>
            {showStreak ? (
              <View
                accessibilityLabel={`${streak} day streak`}
                testID={`game-card-streak-${cardId}`}
                style={styles.streak}
              >
                <Text style={styles.streakFlame}>🔥</Text>
                <Text style={styles.streakCount}>{streak}</Text>
                <Text style={styles.streakLabel}>day streak</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.metaRow}>
            <Text variant="overline" tone="muted" numberOfLines={1} style={styles.turnout}>
              {turnout}
            </Text>
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
              styles.playBtn,
              (pressed || hovered) && styles.playBtnHover,
            ]}
          >
            <PixelIcon name="play" size={32} color={tokens.neon.pink} />
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
          <PixelIcon name="more-horizontal" size={16} color={tokens.text.secondary} />
        </Pressable>
      </View>

      {/* Standings — only when there's something to show. The turnout line
          already carries the nobody-played story; an empty game stays one
          header row tall. Rows are plain views: the card's own press opens
          detail, and the reaction controls are the only buttons inside. */}
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
                onReact={onReact}
                onOpenReactionPicker={onOpenReactionPicker}
              />
            </>
          ) : null}
          {overflow > 0 ? (
            <Text variant="caption" tone="muted" style={styles.moreLine}>
              +{overflow} more
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
});

interface PlayerRowProps {
  row: StandingsRow;
  isMe: boolean;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

function PlayerRow({ row, isMe, onReact, onOpenReactionPicker }: PlayerRowProps) {
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
      <View style={styles.playerLine}>
        <RankMark rank={row.rank} />
        <Avatar
          name={row.displayName}
          imageUrl={row.avatarUrl}
          size="sm"
          testID={`game-card-avatar-${row.userId}`}
        />
        <View
          style={styles.playerBody}
          accessibilityLabel={`${name}${isMe ? " (you)" : ""}: ${row.body ?? "played"}`}
        >
          <Text
            style={[styles.scoreBody, row.body ? null : styles.scoreBodyMuted]}
            testID={`game-card-score-${row.userId}`}
          >
            {row.body ?? "Played"}
          </Text>
          {row.picked || row.adjusted ? (
            <Text style={styles.adjusted} testID={`game-card-adjusted-${row.userId}`}>
              {[row.picked, row.adjusted ? "adjusted" : null].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {isMe ? (
            <View style={styles.youPill}>
              <Text style={styles.youPillText}>you</Text>
            </View>
          ) : null}
        </View>
      </View>
      {row.onFix ? (
        <Pressable
          accessibilityRole="button"
          onPress={row.onFix}
          hitSlop={8}
          style={styles.fixLink}
          testID={`game-card-fix-${row.userId}`}
        >
          <Text style={styles.fixLinkText}>Fix score</Text>
        </Pressable>
      ) : null}
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
    borderBottomColor: tokens.border.default,
  },
  cardHover: { backgroundColor: tokens.bg.surface },
  cardDragging: {
    backgroundColor: tokens.bg.elevated,
    borderRadius: 0,
    borderBottomColor: "transparent",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  cover: { borderRadius: 0 },
  coverImage: {
    width: COVER,
    height: COVER,
    borderRadius: 0,
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
    borderRadius: 0,
  },
  // The streak is earned, so it's the one chartreuse element on the card:
  // chartreuse bezel + count/label on transparent (DESIGN.md "Chartreuse is
  // earned"), reading as "tap to keep your run going", not decor.
  streak: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.chartreuse,
  },
  // Emoji/glyph styles pin an explicit lineHeight ≥ fontSize — iOS clips a
  // glyph to the inherited (22px body) line box otherwise (see app CLAUDE.md).
  streakFlame: { fontSize: 12, lineHeight: 16 },
  // Streak counts are score numerals (pixel face).
  streakCount: {
    ...scoreType(10),
    lineHeight: 16,
    color: tokens.neon.chartreuse,
  },
  // The unit lives next to the count: "🔥 4 day streak". Secondary face so
  // the numeral stays the focal point; same colour + lineHeight.
  streakLabel: {
    ...bodyType("medium"),
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    color: tokens.neon.chartreuse,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    marginTop: 1,
  },
  turnout: { ...uiType(8), flexShrink: 1 },
  // Play is a tap target → pink: neon bezel + neon label on transparent.
  // Bare pink hollow triangle — no box, no label.
  playBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnHover: { opacity: 0.7 },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
  },
  menuBtnHover: { backgroundColor: tokens.bg.elevated },
  standings: { gap: tokens.space.sm },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: 4,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: 0,
  },
  playerLine: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  playerBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  // Reactions ride to the right of the score on the same line — no extra row
  // height. They keep their natural width; the score line flexes to fill.
  reactionsWrap: { flexShrink: 0 },
  adjusted: {
    ...bodyType(),
    fontSize: tokens.font.size.xs,
    color: tokens.text.muted,
    fontStyle: "italic",
  },
  fixLink: { flexShrink: 0, paddingHorizontal: tokens.space.xs },
  fixLinkText: {
    ...uiType(11),
    color: tokens.neon.pinkTint,
    textDecorationLine: "underline",
  },
  playerRowMe: { backgroundColor: tokens.accent.muted },
  rankSlot: {
    width: RANK_SLOT,
    height: RANK_SLOT,
    alignItems: "center",
    justifyContent: "center",
  },
  // Rank numbers are score numerals (pixel face).
  rankText: {
    ...scoreType(10),
    color: tokens.text.muted,
  },
  rankDot: { color: tokens.text.muted, fontSize: tokens.font.size.md },
  // Rank 1 is the spotlight: neon yellow fill, dark numeral (DESIGN.md).
  rankFirst: {
    borderRadius: 0,
    backgroundColor: tokens.neon.yellow,
  },
  rankFirstText: {
    ...scoreType(10),
    color: tokens.text.onAccent,
  },
  youPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
  },
  youPillText: {
    ...uiType(8),
    color: tokens.neon.pinkTint,
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
    backgroundColor: tokens.border.default,
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
    borderRadius: 0,
    opacity: 0.45,
  },
  faceOverlap: { marginLeft: -10 },
  skeletonWrap: { gap: tokens.space.sm },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  skeletonDot: {
    width: AVATAR_SM,
    height: AVATAR_SM,
    borderRadius: 0,
    backgroundColor: tokens.bg.elevated,
  },
  skeletonBar: {
    height: 10,
    borderRadius: 0,
    backgroundColor: tokens.bg.elevated,
  },
});
