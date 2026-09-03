// The board that grows out of a ledger row. Same content the old `/games/:id`
// screen carried — today's standings, the composer, edit/clear, reactions,
// per-day history — but it never becomes a screen, so the row's score rail
// runs straight down through it and the games above and below stay one tap
// away as spines.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { Game, GameStandingsEntry } from "@workshop/shared/games";
import { formatRelative } from "@workshop/ui";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { ScoreReactions } from "../games/components/ScoreReactions";
import { summarizeGameScoreBody } from "../games/lib/scoresSummary";
import { Avatar, Button, PixelIcon, pixelType, TextField, tokens } from "../theme";
import { Text } from "../theme/Text";
import { ledgerMetrics } from "./LedgerRow";
import { railSaysItAll, railScore } from "./railScore";

const { GUTTER, RAIL_W } = ledgerMetrics;

export interface HistoryCell {
  dateKey: string;
  label: string;
  /** Your distilled result for that day, or null if you didn't play. */
  body: string | null;
  loading: boolean;
}

export interface GameBoardPanelProps {
  game: Game;
  entries: GameStandingsEntry[];
  loading: boolean;
  selfId: string | null;
  viewingToday: boolean;
  viewDate: string;
  history: HistoryCell[];
  onSelectDate: (dateKey: string) => void;

  draft: string;
  editing: boolean;
  pending: boolean;
  onChangeDraft: (v: string) => void;
  onSubmit: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onClear: () => void;
  onPlay: () => void;

  onReact: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker: (userId: string) => void;

  onOpenGame: () => void;
  onReteach?: (() => void) | undefined;
  onRemove: () => void;

  myName: string | null;
  myAvatarUrl: string | null;
}

export function GameBoardPanel(props: GameBoardPanelProps) {
  const {
    game,
    entries,
    loading,
    selfId,
    viewingToday,
    viewDate,
    history,
    onSelectDate,
    draft,
    editing,
    pending,
    onChangeDraft,
    onSubmit,
    onCancelEdit,
    onStartEdit,
    onClear,
    onPlay,
    onReact,
    onOpenReactionPicker,
    onOpenGame,
    onReteach,
    onRemove,
    myName,
    myAvatarUrl,
  } = props;

  const scored = entries.filter((e) => (e.scoreRaw ?? "").length > 0);
  const myEntry = selfId ? scored.find((e) => e.userId === selfId) : undefined;
  const myScore = myEntry?.scoreRaw?.trim() ? myEntry.scoreRaw : null;
  const showComposer = viewingToday && (!myScore || editing);

  const trimmed = draft.trim();
  const unchanged = editing && trimmed === (myEntry?.scoreRaw ?? "").trim();
  const canSubmit = trimmed.length > 0 && !unchanged && !pending;

  // RN-Web's TextInput overwrites custom key handlers; routing Enter through
  // onSubmitEditing is the only reliable path (results arrive by paste, so a
  // literal newline keystroke is almost never intended).
  const webProps =
    Platform.OS === "web"
      ? {
          blurOnSubmit: true,
          onSubmitEditing: () => {
            if (canSubmit) onSubmit();
          },
        }
      : {};

  return (
    <View style={styles.root} testID="game-board">
      {loading ? (
        <View style={styles.standings}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <View style={styles.skeletonBar} />
            </View>
          ))}
        </View>
      ) : scored.length === 0 ? (
        <Text style={styles.quiet}>
          {viewingToday ? "No results yet today." : "Nobody played this day."}
        </Text>
      ) : (
        <View style={styles.standings}>
          {scored.map((entry) => (
            <StandingRow
              key={entry.userId}
              entry={entry}
              game={game}
              isMe={entry.userId === selfId}
              canEdit={viewingToday && entry.userId === selfId && !editing}
              onStartEdit={onStartEdit}
              onClear={onClear}
              onReact={onReact}
              onOpenReactionPicker={onOpenReactionPicker}
            />
          ))}
        </View>
      )}

      {showComposer ? (
        <View style={styles.composer} testID="game-board-paste-slot">
          <View style={styles.composerHead}>
            <Text style={styles.sectionLabel}>{editing ? "EDIT RESULT" : "YOUR RESULT"}</Text>
            {editing ? null : (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Play ${game.title}`}
                onPress={onPlay}
                hitSlop={8}
                testID="game-board-play"
                style={({ pressed }) => [styles.playAction, pressed && styles.dim]}
              >
                <Text style={styles.playLabel}>PLAY</Text>
                <PixelIcon name="external-link" size={16} color={tokens.neon.pink} />
              </Pressable>
            )}
          </View>
          <View style={styles.composerBody}>
            <Avatar name={myName} imageUrl={myAvatarUrl} size="sm" />
            <TextField
              testID="game-board-paste-input"
              value={draft}
              onChangeText={onChangeDraft}
              placeholder="Paste your result"
              mono
              multiline
              autoFocus={editing}
              maxLength={2000}
              style={styles.input}
              {...webProps}
            />
          </View>
          <View style={styles.composerActions}>
            {editing ? (
              <Button
                label="Cancel"
                variant="ghost"
                onPress={onCancelEdit}
                disabled={pending}
                testID="game-board-edit-cancel"
              />
            ) : null}
            <Button
              label={editing ? "Save" : "Post score"}
              onPress={onSubmit}
              disabled={!canSubmit}
              loading={pending}
              testID="game-board-paste-submit"
            />
          </View>
        </View>
      ) : null}

      <View style={styles.history}>
        <Text style={styles.sectionLabel}>YOUR LAST 7</Text>
        <View style={styles.historyRow}>
          {history.map((cell) => {
            const selected = cell.dateKey === viewDate;
            const line = cell.body?.split("\n")[0]?.trim() ?? null;
            // A 44px cell can hold "4/6" but not a share grid. Anything longer
            // collapses to a lit square: played, and worth opening that day.
            const body = line && [...line].length <= 5 ? line : null;
            const played = !!line;
            return (
              <Pressable
                key={cell.dateKey}
                accessibilityRole="button"
                accessibilityLabel={`Show ${cell.label}${body ? `, you scored ${body}` : ", not played"}`}
                accessibilityState={{ selected }}
                onPress={() => onSelectDate(cell.dateKey)}
                testID={`game-history-${cell.dateKey}`}
                style={({ pressed }) => [styles.historyCell, pressed && styles.dim]}
              >
                <Text style={[styles.historyDay, selected && styles.historyDaySelected]}>
                  {cell.label}
                </Text>
                {cell.loading ? (
                  <View style={styles.historyPending} />
                ) : body ? (
                  <Text numberOfLines={1} style={styles.historyBody}>
                    {body}
                  </Text>
                ) : (
                  <View style={[styles.historyMark, played && styles.historyMarkPlayed]} />
                )}
                <View style={[styles.historyBar, selected && styles.historyBarOn]} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.gameActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${game.title}`}
          onPress={onOpenGame}
          hitSlop={6}
          testID="game-menu-open"
          style={({ pressed }) => [pressed && styles.dim]}
        >
          <Text style={styles.actionText}>OPEN GAME</Text>
        </Pressable>
        {onReteach ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Re-teach scoring"
            onPress={onReteach}
            hitSlop={6}
            testID="game-menu-reteach"
            style={({ pressed }) => [pressed && styles.dim]}
          >
            <Text style={styles.actionText}>RE-TEACH</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${game.title} from My Games`}
          onPress={onRemove}
          hitSlop={6}
          testID="game-menu-remove"
          style={({ pressed }) => [pressed && styles.dim]}
        >
          <Text style={[styles.actionText, styles.actionDanger]}>REMOVE</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface StandingRowProps {
  entry: GameStandingsEntry;
  game: Game;
  isMe: boolean;
  canEdit: boolean;
  onStartEdit: () => void;
  onClear: () => void;
  onReact: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker: (userId: string) => void;
}

function StandingRow({
  entry,
  game,
  isMe,
  canEdit,
  onStartEdit,
  onClear,
  onReact,
  onOpenReactionPicker,
}: StandingRowProps) {
  // The rail keeps the column aligned all the way down the board; anything it
  // can't hold (a share grid) prints full width under the name instead of an
  // ellipsis that reads like a menu.
  const body = summarizeGameScoreBody(game, entry);
  const rail = railScore(game, entry);
  const complete = railSaysItAll(game, entry);
  const head = rail ?? (body ? "" : "Played");
  const rest = complete ? [] : (body?.split("\n") ?? []);
  const name = entry.displayName?.trim() || "Someone";
  const canReact = !isMe;
  return (
    <View style={[styles.entry, isMe && styles.entryMe]} testID={`game-board-row-${entry.userId}`}>
      <View style={styles.entryLine}>
        <Text style={[styles.rank, entry.rank === 1 && styles.rankTop]}>
          {entry.rank != null ? entry.rank : "–"}
        </Text>
        <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="sm" />
        <View style={styles.entryName}>
          <Text numberOfLines={1} style={styles.entryNameText}>
            {isMe ? `${name} (you)` : name}
          </Text>
        </View>
        {head ? (
          <Text
            numberOfLines={1}
            style={[styles.entryScore, entry.rank === 1 && styles.entryScoreTop]}
            testID={`game-board-score-${entry.userId}`}
          >
            {head}
          </Text>
        ) : (
          // Nothing short enough for the rail, and no parsed number — the
          // full result is printed below, so the rail just marks "played".
          <View style={styles.entryScoreMark} testID={`game-board-score-${entry.userId}`} />
        )}
      </View>
      {rest.length > 0 ? <Text style={styles.entryRest}>{rest.join("\n")}</Text> : null}
      {canReact || (entry.reactions?.length ?? 0) > 0 ? (
        <View style={styles.entryFoot}>
          <ScoreReactions
            reactions={entry.reactions ?? []}
            testIDPrefix={`game-board-react-${entry.userId}`}
            {...(canReact ? { onToggle: (emoji, cur) => onReact(entry.userId, emoji, cur) } : {})}
            {...(canReact ? { onAdd: () => onOpenReactionPicker(entry.userId) } : {})}
          />
        </View>
      ) : null}
      {canEdit ? (
        <View style={styles.entryFoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit your score"
            onPress={onStartEdit}
            hitSlop={6}
            testID="game-board-edit-score"
            style={({ pressed }) => [pressed && styles.dim]}
          >
            <Text style={styles.actionText}>EDIT</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear your score for today"
            onPress={onClear}
            hitSlop={6}
            testID="game-board-clear-score"
            style={({ pressed }) => [pressed && styles.dim]}
          >
            <Text style={[styles.actionText, styles.actionQuiet]}>CLEAR</Text>
          </Pressable>
          {entry.updatedAt ? (
            <Text style={styles.posted}>posted {formatRelative(entry.updatedAt)}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingBottom: tokens.space.lg, gap: tokens.space.lg },
  quiet: {
    fontSize: 13,
    lineHeight: 18,
    color: tokens.text.secondary,
    paddingLeft: GUTTER,
    paddingTop: tokens.space.xs,
  },
  standings: { paddingTop: tokens.space.xs },
  skeletonRow: { height: 26, justifyContent: "center", paddingLeft: GUTTER },
  skeletonBar: { height: 8, width: "55%", backgroundColor: tokens.bg.elevated },
  entry: { paddingVertical: 5 },
  entryMe: {
    borderLeftWidth: tokens.bezel,
    borderLeftColor: tokens.neon.pink,
    marginLeft: -tokens.bezel,
    paddingLeft: tokens.bezel,
  },
  entryLine: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  rank: { ...pixelType(10), width: 16, color: tokens.text.secondary },
  rankTop: { color: tokens.neon.yellow },
  entryName: { flex: 1, minWidth: 0 },
  entryNameText: { fontSize: 13, lineHeight: 18, color: tokens.text.primary },
  entryScore: {
    ...pixelType(12),
    width: RAIL_W,
    textAlign: "right",
    color: tokens.text.primary,
  },
  entryScoreTop: { color: tokens.neon.yellow },
  entryScoreMark: {
    width: RAIL_W,
    alignItems: "flex-end",
  },
  entryRest: {
    paddingLeft: GUTTER,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    lineHeight: 15,
    color: tokens.text.secondary,
  },
  entryFoot: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingLeft: GUTTER,
    paddingTop: 4,
  },
  posted: { fontSize: 11, lineHeight: 14, color: tokens.text.secondary },
  sectionLabel: { ...pixelType(10), color: tokens.text.secondary },
  composer: {
    gap: tokens.space.sm,
    borderTopWidth: 1,
    borderTopColor: tokens.border.default,
    paddingTop: tokens.space.md,
  },
  composerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  composerBody: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.sm },
  input: { flex: 1, minHeight: 76, paddingHorizontal: tokens.space.sm },
  composerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  playAction: { flexDirection: "row", alignItems: "center", gap: 4 },
  playLabel: { ...pixelType(10), color: tokens.neon.pink },
  dim: { opacity: 0.6 },
  history: {
    gap: tokens.space.sm,
    borderTopWidth: 1,
    borderTopColor: tokens.border.default,
    paddingTop: tokens.space.md,
  },
  historyRow: { flexDirection: "row", justifyContent: "space-between" },
  historyCell: { flex: 1, alignItems: "center", gap: 4 },
  historyDay: { fontSize: 9, lineHeight: 11, letterSpacing: 1, color: tokens.text.secondary },
  historyDaySelected: { color: tokens.text.primary },
  historyBody: { ...pixelType(10), color: tokens.text.primary },
  historyPending: { width: 8, height: 8, marginVertical: 4, backgroundColor: tokens.bg.raised },
  historyMark: {
    width: 8,
    height: 8,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  historyMarkPlayed: {
    backgroundColor: tokens.neon.chartreuse,
    borderColor: tokens.neon.chartreuse,
  },
  historyBar: { height: 2, width: "60%", backgroundColor: "transparent" },
  historyBarOn: { backgroundColor: tokens.neon.pink },
  gameActions: {
    flexDirection: "row",
    gap: tokens.space.lg,
    borderTopWidth: 1,
    borderTopColor: tokens.border.default,
    paddingTop: tokens.space.md,
  },
  actionText: { ...pixelType(10), color: tokens.neon.pink },
  actionQuiet: { color: tokens.text.secondary },
  actionDanger: { color: tokens.status.danger },
});
