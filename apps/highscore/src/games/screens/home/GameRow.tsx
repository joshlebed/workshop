// BY GAME: one game, its day. The game's mark and name up top; underneath, a
// column per player who posted — their face over their score — in the server's
// rank order, so the winner is always leftmost and the day reads left to right.
//
// The same ScoreCell the BY PLAYER matrix uses, under a per-row header of faces
// instead of a shared header of game marks. That is the whole transpose: both
// projections are a header strip over a row of cells; only the axis changes.
//
// When you haven't posted yet, your own empty cell sits at the end of the strip
// under your own face — the gap in the row *is* the affordance, so there's no
// separate "log a score" button competing with Play.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { MyGame } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { memo, useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Measurable } from "../../../components/Flight";
import { Avatar, PixelIcon, Text, tokens } from "../../../theme";
import { GameCover } from "../../components/GameCover";
import { CELL_GAP, CELL_HEIGHT, CELL_WIDTH, ScoreCell } from "../../components/ScoreCell";
import type { StandingCell } from "../../lib/matrix";

export const GAME_COVER = 32;
const MAX_COLUMNS = 5;

export interface GameRowProps {
  game: MyGame;
  /** Standings for the day being viewed (not necessarily today). */
  cells: StandingCell[];
  /** Today's streak for the viewer — the "keep it going" nudge. */
  streak: number;
  /** Scores post to today only; past days hide the play affordances. */
  viewingToday: boolean;
  viewerHasPlayed: boolean;
  viewerName: string | null;
  viewerId: string | null;
  loading: boolean;
  isDragging: boolean;
  onOpenBoard: (source: Measurable | null) => void;
  onPeek: () => void;
  onPlay: () => void;
  onPaste: () => void;
  onPressPlayer: (userId: string) => void;
  /** Native drag activation; web drags from the list wrapper. */
  onLongPressBody?: () => void;
}

export const GameRow = memo(function GameRow({
  game,
  cells,
  streak,
  viewingToday,
  viewerHasPlayed,
  viewerName,
  viewerId,
  loading,
  isDragging,
  onOpenBoard,
  onPeek,
  onPlay,
  onPaste,
  onPressPlayer,
  onLongPressBody,
}: GameRowProps) {
  const coverRef = useRef<View>(null);
  const title = game.game.title;
  const shown = cells.slice(0, MAX_COLUMNS);
  const overflow = cells.length - shown.length;
  const showStreak = viewingToday && streak >= STREAK_MIN_DAYS;
  const openSlot = viewingToday && !viewerHasPlayed;

  return (
    <View style={[styles.row, isDragging && styles.dragging]} testID={`game-row-${game.gameId}`}>
      <View style={styles.head}>
        {/* The identity glyph peeks; the name navigates. One rule, every row. */}
        <Pressable
          ref={coverRef}
          accessibilityRole="button"
          accessibilityLabel={`Preview ${title} standings`}
          onPress={onPeek}
          onLongPress={onLongPressBody}
          delayLongPress={280}
          testID={`game-row-peek-${game.gameId}`}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <GameCover iconUrl={game.game.iconUrl} size={GAME_COVER} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open the ${title} board`}
          onPress={() => onOpenBoard(coverRef.current)}
          onLongPress={onLongPressBody ?? onPeek}
          delayLongPress={280}
          testID={`game-row-open-${game.gameId}`}
          style={({ pressed }) => [styles.titleBox, pressed && styles.pressed]}
        >
          <Text variant="heading" numberOfLines={1}>
            {title}
          </Text>
        </Pressable>

        {showStreak ? (
          <View style={styles.streak} testID={`game-row-streak-${game.gameId}`}>
            <PixelIcon name="zap" size={12} color={tokens.neon.chartreuse} />
            <Text variant="cell" tone="success" style={styles.streakCount}>
              {streak}
            </Text>
          </View>
        ) : null}

        {openSlot ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Play ${title}`}
            onPress={onPlay}
            onLongPress={onLongPressBody}
            delayLongPress={280}
            hitSlop={8}
            testID={`game-row-play-${game.gameId}`}
            style={({ pressed }) => [styles.play, pressed && styles.pressed]}
          >
            <Text variant="cell" style={styles.playLabel}>
              Play
            </Text>
            <PixelIcon name="play" size={12} color={tokens.neon.pinkTint} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.strip}>
        {loading ? (
          [0, 1].map((i) => <View key={i} style={styles.skeleton} />)
        ) : (
          <>
            {shown.map((cell) => (
              <View key={cell.userId} style={styles.column}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    cell.isSelf ? "You" : `Open ${cell.displayName?.trim() ?? "player"}`
                  }
                  onPress={cell.isSelf ? undefined : () => onPressPlayer(cell.userId)}
                  onLongPress={onLongPressBody}
                  delayLongPress={280}
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Avatar
                    name={cell.displayName}
                    imageUrl={userAvatarImageUrl(cell.userId)}
                    size="sm"
                  />
                </Pressable>
                <ScoreCell
                  played
                  glyph={cell.glyph}
                  outrightFirst={cell.outrightFirst}
                  markFirst={false}
                  isSelf={cell.isSelf}
                  accessibilityLabel={`${cell.isSelf ? "You" : (cell.displayName?.trim() ?? "Someone")}: ${cell.body ?? "played"}`}
                  onPress={() => onOpenBoard(coverRef.current)}
                  onLongPress={onLongPressBody ?? onPeek}
                  testID={`game-row-cell-${game.gameId}-${cell.userId}`}
                />
              </View>
            ))}

            {overflow > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${overflow} more players — open the ${title} board`}
                onPress={() => onOpenBoard(coverRef.current)}
                style={styles.overflow}
              >
                <Text variant="cell" tone="secondary">
                  +{overflow}
                </Text>
              </Pressable>
            ) : null}

            {/* Your empty slot: the gap in the row, made tappable. */}
            {openSlot ? (
              <View style={styles.column}>
                <Avatar
                  name={viewerName}
                  imageUrl={viewerId ? userAvatarImageUrl(viewerId) : null}
                  size="sm"
                  style={styles.selfFace}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Paste your ${title} result`}
                  onPress={onPaste}
                  onLongPress={onLongPressBody}
                  delayLongPress={280}
                  testID={`game-row-paste-${game.gameId}`}
                  style={({ pressed }) => [styles.pasteCell, pressed && styles.pasteCellPressed]}
                >
                  <PixelIcon name="plus" size={16} color={tokens.neon.pink} />
                </Pressable>
              </View>
            ) : null}

            {cells.length === 0 && !openSlot ? (
              <Text variant="caption" tone="secondary" style={styles.emptyLine}>
                {viewingToday ? "Nobody's played yet" : "Nobody played"}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingVertical: tokens.space.sm,
    gap: tokens.space.xs,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  dragging: { backgroundColor: tokens.bg.surface, borderBottomColor: tokens.neon.pink },
  head: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  pressed: { opacity: 0.6 },
  titleBox: { flex: 1, minWidth: 0, paddingVertical: tokens.space.xs },
  streak: { flexDirection: "row", alignItems: "center", gap: 3 },
  streakCount: { letterSpacing: 0 },
  play: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs, paddingVertical: 4 },
  playLabel: { color: tokens.neon.pinkTint, letterSpacing: 0 },
  strip: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: CELL_GAP,
    minHeight: CELL_HEIGHT,
    paddingLeft: GAME_COVER + tokens.space.sm,
  },
  column: { gap: tokens.space.xs, width: CELL_WIDTH, alignItems: "center" },
  selfFace: { opacity: 0.5 },
  overflow: { width: 28, height: CELL_HEIGHT, alignItems: "center", justifyContent: "center" },
  pasteCell: {
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderStyle: "dashed",
  },
  pasteCellPressed: { borderColor: tokens.neon.pink, borderStyle: "solid" },
  emptyLine: { alignSelf: "center" },
  skeleton: { width: CELL_WIDTH, height: CELL_HEIGHT, backgroundColor: tokens.bg.surface },
});
