// BY PLAYER: the same day, transposed. A frozen column of players on the left
// and one aligned column per game on the right, so you can read *across* a row
// (how someone's day went) or *down* a column (who won Wordle) — the two
// questions a per-game card stack can't answer at all.
//
// The score grid is a single horizontal scroller shared by the header of game
// marks and every player row, so all columns move together and the names never
// leave. You are always the first row, played or not. The left and right halves
// of a row stagger in with identical timing, so they stay welded during the
// projection flip.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { MyGame } from "@workshop/shared/games";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { Measurable } from "../../../components/Flight";
import { Avatar, PixelIcon, Text, tokens } from "../../../theme";
import { GameCover } from "../../components/GameCover";
import { CELL_GAP, CELL_HEIGHT, CELL_WIDTH, ScoreCell } from "../../components/ScoreCell";
import type { PlayerCell, PlayerRow } from "../../lib/matrix";
import { Stagger } from "./Stagger";

const NAME_COLUMN = 116;
/** Idle players collapse behind one row rather than padding the grid with blanks. */
const IDLE_COLLAPSE_THRESHOLD = 2;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = CELL_HEIGHT + CELL_GAP;

interface ByPlayerProps {
  rows: PlayerRow[];
  games: MyGame[];
  viewingToday: boolean;
  onOpenPlayer: (userId: string, source: Measurable | null) => void;
  onPeekPlayer: (row: PlayerRow) => void;
  onOpenGame: (gameId: string, source: Measurable | null) => void;
  onPeekGame: (gameId: string) => void;
}

export function ByPlayer({
  rows,
  games,
  viewingToday,
  onOpenPlayer,
  onPeekPlayer,
  onOpenGame,
  onPeekGame,
}: ByPlayerProps) {
  const [showIdle, setShowIdle] = useState(false);
  // You always keep your row; everyone else with nothing posted collapses.
  const { active, idle } = useMemo(() => {
    const activeRows = rows.filter((r) => r.isSelf || r.playedCount > 0);
    const idleRows = rows.filter((r) => !r.isSelf && r.playedCount === 0);
    return idleRows.length > IDLE_COLLAPSE_THRESHOLD && !showIdle
      ? { active: activeRows, idle: idleRows }
      : { active: [...activeRows, ...idleRows], idle: [] };
  }, [rows, showIdle]);

  return (
    <View>
      <View style={styles.matrix} testID="by-player-matrix">
        <View style={styles.nameColumn}>
          <View style={styles.headerSpacer}>
            {/* The grid scrolls sideways; say how many columns are out there
                rather than leaving a clipped cell to imply it. */}
            <Text variant="eyebrow" tone="secondary" style={styles.axisLabel}>
              {games.length} games
            </Text>
            <PixelIcon name="chevron-right" size={12} color={tokens.border.default} />
          </View>
          {active.map((row, index) => (
            <Stagger key={row.userId} index={index} direction={1}>
              <NameCell row={row} onOpen={onOpenPlayer} onPeek={() => onPeekPlayer(row)} />
            </Stagger>
          ))}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.gridContent}
        >
          <View>
            <View style={styles.headerRow}>
              {games.map((mg) => (
                <GameColumnHead
                  key={mg.gameId}
                  game={mg}
                  onOpen={onOpenGame}
                  onPeek={() => onPeekGame(mg.gameId)}
                />
              ))}
            </View>
            {active.map((row, index) => (
              <Stagger key={row.userId} index={index} direction={1}>
                <View style={styles.gridRow}>
                  {row.cells.map((cell) => (
                    <ScoreCell
                      key={cell.gameId}
                      played={cell.played}
                      glyph={cell.glyph}
                      outrightFirst={cell.outrightFirst}
                      isSelf={row.isSelf}
                      accessibilityLabel={cellLabel(row, cell, viewingToday)}
                      onPress={() => onOpenGame(cell.gameId, null)}
                      onLongPress={() => onPeekGame(cell.gameId)}
                      testID={`matrix-cell-${row.userId}-${cell.gameId}`}
                    />
                  ))}
                </View>
              </Stagger>
            ))}
          </View>
        </ScrollView>
      </View>
      {idle.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${idle.length} players who haven't posted`}
          onPress={() => setShowIdle(true)}
          testID="matrix-show-idle"
          style={({ pressed }) => [styles.idleRow, pressed && styles.pressed]}
        >
          <Text variant="caption" tone="secondary">
            {`${idle.length} haven't posted`}
          </Text>
          <PixelIcon name="chevron-down" size={16} color={tokens.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

function cellLabel(row: PlayerRow, cell: PlayerCell, viewingToday: boolean): string {
  const who = row.isSelf ? "You" : (row.displayName?.trim() ?? "Someone");
  if (!cell.played) {
    return `${who} — ${cell.gameTitle}: ${viewingToday ? "not played yet" : "didn't play"}`;
  }
  return `${who} — ${cell.gameTitle}: ${cell.body ?? "played"}${cell.rank === 1 ? ", first" : ""}`;
}

function NameCell({
  row,
  onOpen,
  onPeek,
}: {
  row: PlayerRow;
  onOpen: (userId: string, source: Measurable | null) => void;
  onPeek: () => void;
}) {
  const avatarRef = useRef<View>(null);
  const full = row.displayName?.trim() || "Someone";
  // First name only: a scoreboard column is 116pt wide and "Colin Brinsm…" is
  // less legible than "Colin". The full name rides in the accessibility label.
  const name = row.isSelf ? "You" : (full.split(/\s+/)[0] ?? full);
  const quiet = row.playedCount === 0;
  return (
    <View style={[styles.nameRow, row.isSelf && styles.nameRowSelf]}>
      <Pressable
        ref={avatarRef}
        accessibilityRole="button"
        accessibilityLabel={`Preview ${row.isSelf ? "your" : `${full}'s`} day`}
        onPress={onPeek}
        onLongPress={onPeek}
        delayLongPress={280}
        testID={`matrix-peek-${row.userId}`}
        style={({ pressed }) => [quiet && styles.quiet, pressed && styles.pressed]}
      >
        <Avatar name={row.displayName} imageUrl={userAvatarImageUrl(row.userId)} size="sm" />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={row.isSelf ? "Open your profile" : `Open ${full}'s profile`}
        onPress={() => onOpen(row.userId, avatarRef.current)}
        onLongPress={onPeek}
        delayLongPress={280}
        testID={`matrix-player-${row.userId}`}
        style={({ pressed }) => [styles.nameBox, pressed && styles.pressed]}
      >
        <Text variant="label" numberOfLines={1} style={quiet ? styles.nameQuiet : styles.name}>
          {name}
        </Text>
      </Pressable>
      {row.isLeader ? <PixelIcon name="crown" size={16} color={tokens.neon.yellow} /> : null}
    </View>
  );
}

function GameColumnHead({
  game,
  onOpen,
  onPeek,
}: {
  game: MyGame;
  onOpen: (gameId: string, source: Measurable | null) => void;
  onPeek: () => void;
}) {
  const coverRef = useRef<View>(null);
  return (
    <Pressable
      ref={coverRef}
      accessibilityRole="button"
      accessibilityLabel={`Open the ${game.game.title} board`}
      onPress={() => onOpen(game.gameId, coverRef.current)}
      onLongPress={onPeek}
      delayLongPress={280}
      testID={`matrix-game-${game.gameId}`}
      style={({ pressed }) => [styles.columnHead, pressed && styles.pressed]}
    >
      <GameCover iconUrl={game.game.iconUrl} size={26} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  matrix: { flexDirection: "row" },
  nameColumn: { width: NAME_COLUMN },
  headerSpacer: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    paddingBottom: tokens.space.xs,
  },
  axisLabel: { fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase" },
  nameRow: {
    height: ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingRight: tokens.space.xs,
  },
  nameRowSelf: { backgroundColor: tokens.bg.surface },
  nameBox: { flex: 1, minWidth: 0 },
  name: { color: tokens.text.primary },
  nameQuiet: { color: tokens.text.secondary },
  quiet: { opacity: 0.5 },
  pressed: { opacity: 0.6 },
  gridContent: { paddingRight: tokens.space.md },
  headerRow: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    gap: CELL_GAP,
    alignItems: "flex-end",
    paddingBottom: tokens.space.xs,
  },
  columnHead: { width: CELL_WIDTH, alignItems: "center" },
  gridRow: { height: ROW_HEIGHT, flexDirection: "row", gap: CELL_GAP, alignItems: "flex-start" },
  idleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    minHeight: 36,
  },
});
