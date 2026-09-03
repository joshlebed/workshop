// One day of one game — the unit the whole deck is built from.
//
// A cartridge is a column of these: today at the top with the play slot, then
// yesterday, then earlier. Each block sits on the app's asymmetric grid — the
// day marker in the fixed left column, the standings in the content column —
// so scrolling a cartridge reads as scrolling a ledger, not paging a card
// stack.
//
// Today's standings come free with the deck-wide `GET /v1/games` call; every
// older day fetches its own leaderboard the first time it is asked for, which
// is why blocks take `enabled` rather than firing on mount.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type {
  Game,
  GameLeaderboardResponse,
  GameStandingsEntry,
  GamesResponse,
} from "@workshop/shared/games";
import { confirm, haptics } from "@workshop/ui";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { clearGameScore, fetchGameLeaderboard } from "../games/api/games";
import { ReactionPickerSheet } from "../games/components/ReactionPickerSheet";
import { ScoreReactions } from "../games/components/ScoreReactions";
import { useScoreReactions } from "../games/hooks/useScoreReactions";
import { shiftDateKey } from "../games/lib/gameDate";
import { distillScore } from "../games/lib/scoreMarks";
import { summarizeGameScoreBody } from "../games/lib/scoresSummary";
import { useGamesRuntime } from "../games/runtime";
import { Avatar, GutterRow, glow, PixelIcon, Text, textGlow, tokens, useToast } from "../theme";
import { ScoreGrid, ScoreMarks } from "./ScoreMarks";

interface DayBlockProps {
  game: Game;
  dayKey: string;
  todayKey: string;
  /** Today's entries arrive with the deck; older days fetch their own. */
  todayEntries?: GameStandingsEntry[];
  /** Older days only fetch once the block has been scrolled to. */
  enabled: boolean;
  onPaste: (draft?: string) => void;
}

export const DayBlock = memo(function DayBlock({
  game,
  dayKey,
  todayKey,
  todayEntries,
  enabled,
  onPaste,
}: DayBlockProps) {
  const isToday = dayKey === todayKey;
  const { token, user } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const boardQuery = useQuery({
    queryKey: queryKeys.games.leaderboard(game.id, dayKey),
    queryFn: () => fetchGameLeaderboard(game.id, dayKey, token),
    enabled: !isToday && enabled && !!token,
  });

  // Today reads the deck-wide cache so every cartridge's today block is free;
  // older days read their own leaderboard query.
  const entries = isToday ? (todayEntries ?? []) : (boardQuery.data?.entries ?? []);
  const scored = entries.filter((e) => e.scoreRaw != null && e.scoreRaw.length > 0);

  const reactionCtl = useScoreReactions<GamesResponse | GameLeaderboardResponse>({
    periodKey: dayKey,
    token,
    viewer: user ? { userId: user.id, displayName: user.displayName ?? null } : null,
    queryKey: isToday
      ? queryKeys.games.mine(todayKey)
      : queryKeys.games.leaderboard(game.id, dayKey),
    readReactions: (data, _gameId, scoreUserId) =>
      readEntries(data, game.id).find((e) => e.userId === scoreUserId)?.reactions ?? [],
    writeReactions: (data, _gameId, scoreUserId, next) =>
      writeEntries(data, game.id, (e) =>
        e.userId === scoreUserId ? { ...e, reactions: next } : e,
      ),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearGameScore(game.id, todayKey, token),
    onSuccess: async () => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(todayKey) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(game.id, todayKey),
        }),
      ]);
      // No toast: your row leaving the board is the confirmation.
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" });
    },
  });

  const onClear = async () => {
    const ok = await confirm({
      title: "Clear your score for today?",
      message: "Your result is removed. Scores on other days are kept.",
      confirmLabel: "Clear",
      destructive: true,
    });
    if (ok) clearMutation.mutate();
  };

  const loading = !isToday && enabled && boardQuery.isPending;

  return (
    <GutterRow
      rule
      marker={<DayMark dayKey={dayKey} todayKey={todayKey} />}
      style={scored.length === 0 ? styles.blockQuiet : styles.block}
      testID={`day-block-${game.id}-${dayKey}`}
    >
      {loading ? (
        // Score-shaped placeholders, not a spinner: several days load at once
        // and a column of spinners reads as an error state.
        <View style={styles.skeletonRow}>
          <ScoreMarks marks={["blank", "blank", "blank", "blank", "blank"]} />
        </View>
      ) : scored.length === 0 ? (
        <Text variant="caption" tone="muted" style={styles.quietText}>
          {isToday ? "Nobody yet" : "No plays"}
        </Text>
      ) : (
        <View style={styles.rows}>
          {scored.map((entry) => (
            <StandingRow
              key={entry.userId}
              entry={entry}
              game={game}
              isMe={entry.userId === user?.id}
              spotlight={isToday}
              rowId={`${game.id}-${dayKey}-${entry.userId}`}
              {...(isToday && entry.userId === user?.id
                ? { onEdit: () => onPaste(entry.scoreRaw ?? ""), onClear }
                : {})}
              {...(entry.userId === user?.id
                ? {}
                : {
                    onReact: (emoji: string, reacted: boolean) =>
                      reactionCtl.react(game.id, entry.userId, emoji, reacted),
                    onOpenPicker: () =>
                      reactionCtl.openPicker(game.id, entry.userId, entry.displayName ?? null),
                  })}
            />
          ))}
        </View>
      )}

      <ReactionPickerSheet
        visible={!!reactionCtl.target}
        targetName={reactionCtl.target?.name ?? null}
        current={reactionCtl.currentEmoji}
        onPick={reactionCtl.pick}
        onRemove={reactionCtl.removeReaction}
        onClose={reactionCtl.closePicker}
      />
    </GutterRow>
  );
});

function readEntries(
  data: GamesResponse | GameLeaderboardResponse,
  gameId: string,
): GameStandingsEntry[] {
  if ("games" in data) {
    return data.games.find((g) => g.gameId === gameId)?.standings.entries ?? [];
  }
  return data.entries;
}

function writeEntries(
  data: GamesResponse | GameLeaderboardResponse,
  gameId: string,
  map: (entry: GameStandingsEntry) => GameStandingsEntry,
): GamesResponse | GameLeaderboardResponse {
  if ("games" in data) {
    return {
      ...data,
      games: data.games.map((g) =>
        g.gameId === gameId
          ? { ...g, standings: { ...g.standings, entries: g.standings.entries.map(map) } }
          : g,
      ),
    };
  }
  return { ...data, entries: data.entries.map(map) };
}

/**
 * The day, stacked in the marker column: weekday over date, every day the
 * same shape. Today isn't labelled "TODAY" — it's the yellow one, which is
 * exactly what neon yellow is for (spotlight the thing to look at).
 */
function DayMark({ dayKey, todayKey }: { dayKey: string; todayKey: string }) {
  const isToday = dayKey === todayKey;
  const isYesterday = dayKey === shiftDateKey(todayKey, -1);
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = y && m && d ? new Date(y, m - 1, d) : null;
  const weekday = date ? date.toLocaleDateString(undefined, { weekday: "short" }) : dayKey;
  const tone = isToday ? "spotlight" : isYesterday ? "secondary" : "muted";
  return (
    <View accessible accessibilityLabel={isToday ? "Today" : `${weekday} ${d ?? ""}`}>
      <Text variant="heading" tone={tone} style={styles.markLine}>
        {weekday}
      </Text>
      <Text variant="heading" tone={tone} style={styles.markLine}>
        {d ?? ""}
      </Text>
    </View>
  );
}

/**
 * The cartridge's one control: go play it, or log a result you already have.
 * They are the same decision, so they share a bezel rather than being a
 * button next to a text link. Lives in the cartridge header, not in the
 * standings, so rank 1 stays at the top of the board.
 */
export function PlayControl({
  gameId,
  onPlay,
  onPaste,
}: {
  gameId: string;
  onPlay: () => void;
  onPaste: () => void;
}) {
  return (
    <View style={styles.slot} testID={`deck-play-slot-${gameId}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Play now"
        onPress={onPlay}
        testID={`deck-play-${gameId}`}
        style={({ pressed }) => [styles.playHalf, pressed && styles.playHalfPressed]}
      >
        <PixelIcon name="play" size={16} color={tokens.text.onAccent} />
        <Text variant="heading" tone="onAccent" style={styles.playLabel}>
          Play
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Paste your result"
        onPress={onPaste}
        testID={`deck-paste-${gameId}`}
        style={({ pressed }) => [styles.pasteHalf, pressed && styles.pasteHalfPressed]}
      >
        <Text variant="heading" style={styles.pasteLabel}>
          Paste
        </Text>
      </Pressable>
    </View>
  );
}

interface StandingRowProps {
  entry: GameStandingsEntry;
  /** Unique across every day of every cartridge — rows repeat by design. */
  rowId: string;
  game: Pick<Game, "title" | "url" | "summarySpec">;
  isMe: boolean;
  /** Today's leader is the one spotlight moment that glows. */
  spotlight: boolean;
  onEdit?: () => void;
  onClear?: () => void;
  /** Toggling an existing chip. Adding a new one is the row tap. */
  onReact?: (emoji: string, currentlyReacted: boolean) => void;
  /** Tapping a friend's row opens the reaction picker — there is no
   *  permanent add button sitting on every row. */
  onOpenPicker?: () => void;
}

function StandingRow({
  entry,
  rowId,
  game,
  isMe,
  spotlight,
  onEdit,
  onClear,
  onOpenPicker,
  onReact,
}: StandingRowProps) {
  const name = entry.displayName?.trim() || "Someone";
  // The provider's share copy never reaches the row: it is reduced to one
  // rankable token plus the picture, so every row is the same shape and the
  // score column actually lines up.
  const { token, marks, grid, text } = distillScore(summarizeGameScoreBody(game, entry));
  const leader = entry.rank === 1;
  const canReact = !isMe && !!onOpenPicker;

  return (
    <View style={[styles.row, isMe && styles.rowMine]} testID={`deck-row-${rowId}`}>
      <Pressable
        accessibilityRole={canReact ? "button" : undefined}
        accessibilityLabel={`${name}${isMe ? " (you)" : ""}: ${token ?? text ?? "played"}`}
        {...(canReact ? { accessibilityHint: "React to this score" } : {})}
        onPress={canReact ? onOpenPicker : undefined}
        style={({ pressed }) => [styles.rowMain, pressed && canReact && styles.rowPressed]}
      >
        <Text
          variant="score"
          tone={leader ? "spotlight" : "muted"}
          style={[styles.rank, leader && spotlight ? textGlow(tokens.neon.yellowGlow, 8) : null]}
        >
          {entry.rank ?? "\u00b7"}
        </Text>
        <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="sm" />
        <View style={styles.rowBody}>
          <Text variant="label" numberOfLines={1} tone={isMe ? "primary" : "secondary"}>
            {name}
          </Text>
          {grid.length > 0 ? (
            <View style={styles.rowGrid}>
              <ScoreGrid grid={grid} />
            </View>
          ) : null}
        </View>
        <View style={styles.scoreCol}>
          <ScoreMarks marks={marks} />
          {token ? (
            <Text
              variant="score"
              tone={isMe ? "primary" : "secondary"}
              style={styles.score}
              testID={`deck-score-${rowId}`}
            >
              {token}
            </Text>
          ) : marks.length === 0 && grid.length === 0 ? (
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.scoreText}>
              {text ?? "Played"}
            </Text>
          ) : null}
        </View>
      </Pressable>

      {onEdit || onClear ? (
        <View style={styles.rowActions}>
          {onEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit your score"
              onPress={onEdit}
              hitSlop={8}
              testID={`deck-edit-score-${rowId}`}
            >
              <Text variant="label" style={styles.rowAction}>
                Edit
              </Text>
            </Pressable>
          ) : null}
          {onClear ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear your score for today"
              onPress={onClear}
              hitSlop={8}
              testID={`deck-clear-score-${rowId}`}
            >
              <Text variant="label" style={styles.rowActionDanger}>
                Clear
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {entry.reactions.length > 0 ? (
        <View style={styles.rowReactions}>
          <ScoreReactions
            reactions={entry.reactions}
            testIDPrefix={`deck-react-${rowId}`}
            {...(onReact ? { onToggle: onReact } : {})}
          />
        </View>
      ) : null}
    </View>
  );
}

const RANK_W = 18;
const AVATAR_SM = 24;

const styles = StyleSheet.create({
  block: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.lg,
  },
  // A day nobody played is one line, not a section.
  blockQuiet: { paddingTop: 2, paddingBottom: 2 },
  markLine: { fontSize: 10, lineHeight: 16, letterSpacing: 1 },
  skeletonRow: { paddingVertical: tokens.space.sm, opacity: 0.35 },
  quietText: { paddingVertical: 2 },
  rows: { gap: tokens.space.sm },
  row: { gap: 2 },
  // Your row is marked by the grid, not by a pill: a lit edge on the rule side.
  rowMine: {
    borderLeftWidth: tokens.bezel,
    borderLeftColor: tokens.neon.pink,
    marginLeft: -tokens.space.md,
    paddingLeft: tokens.space.md - tokens.bezel,
  },
  rowMain: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.sm },
  rowPressed: { backgroundColor: tokens.bg.surface },
  rank: { width: RANK_W, fontSize: 12, lineHeight: 24, textAlign: "right" },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowGrid: { paddingTop: 2, paddingBottom: 2 },
  // Marks over token, right-aligned: the token column lines up across every
  // row of every game.
  scoreCol: { alignItems: "flex-end", gap: 3, minWidth: 48, paddingTop: 5 },
  score: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  scoreText: { textAlign: "right", maxWidth: 110 },
  rowActions: {
    flexDirection: "row",
    gap: tokens.space.md,
    paddingLeft: RANK_W + AVATAR_SM + tokens.space.sm * 2,
  },
  rowAction: { color: tokens.neon.pinkTint, fontSize: 12 },
  rowActionDanger: { color: tokens.text.secondary, fontSize: 12 },
  rowReactions: { paddingLeft: RANK_W + AVATAR_SM + tokens.space.sm * 2 },
  slot: {
    flexDirection: "row",
    alignSelf: "flex-start",
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    ...glow(tokens.neon.pinkGlow, 12),
  },
  playHalf: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    backgroundColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    height: 32,
  },
  playHalfPressed: { backgroundColor: tokens.neon.pinkTint },
  playLabel: { fontSize: 10 },
  pasteHalf: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.md,
    height: 32,
    borderLeftWidth: tokens.bezel,
    borderLeftColor: tokens.neon.pink,
  },
  pasteHalfPressed: { backgroundColor: tokens.accent.muted },
  pasteLabel: { fontSize: 10, color: tokens.neon.pinkTint },
});
