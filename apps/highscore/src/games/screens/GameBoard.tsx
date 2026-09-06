import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, GameLeaderboardResponse, GameStandingsEntry } from "@workshop/shared/games";
import {
  Avatar,
  Button,
  confirm,
  EmptyState,
  formatRelative,
  haptics,
  openExternalUrl,
  Screen,
  Text,
  tokens,
  useToast,
} from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { clearGameScore, fetchGameLeaderboard, fetchMyGames, upsertGameScore } from "../api/games";
import { DAY_RAIL_DEFAULT_LENGTH, DayRail } from "../components/DayRail";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { ScoreReactions } from "../components/ScoreReactions";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { formatGameDateLabel, localDateKey, resolveRailDate } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";

/**
 * Per-game board (G1b) — history for one game in My Games. The home card
 * owns today's standings; this screen is for paging back through past days
 * (DayRail) plus a paste slot for whichever day is showing.
 *
 * Rules:
 *   - Pasted scores upload to the bucket of the *selected* day, so a result
 *     finished just after midnight can still be posted to "Yesterday". Edit
 *     and Clear follow the same day.
 *   - Going past today on the day rail isn't offered.
 */
export default function GameBoard() {
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, user, routes } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  // `?date=` carries the home rail's selection so drilling in from
  // "Yesterday" opens on yesterday; anything the rail can't show → today.
  const [date, setDate] = useState(() =>
    resolveRailDate(params.date, today, DAY_RAIL_DEFAULT_LENGTH),
  );
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);

  // The catalog row (title / URL) comes from the My Games query — there's no
  // standalone `GET /v1/games/:id`. Navigation always arrives from the home
  // cards, so the row is in cache; a cold deep-link refetches the list.
  const myGamesQuery = useQuery({
    queryKey: queryKeys.games.mine(today),
    queryFn: () => fetchMyGames(today, token),
    enabled: !!token,
  });
  const myGame = myGamesQuery.data?.games.find((g) => g.gameId === gameId);
  const game = myGame?.game ?? null;

  const boardQuery = useQuery({
    queryKey: queryKeys.games.leaderboard(gameId ?? "", date),
    queryFn: () => fetchGameLeaderboard(gameId ?? "", date, token),
    enabled: !!token && !!gameId,
  });

  const upsertMutation = useMutation({
    mutationFn: ({
      scoreRaw,
      periodKey,
    }: {
      scoreRaw: string;
      periodKey: string;
      isEdit: boolean;
    }) => {
      if (!gameId) throw new Error("missing game id");
      return upsertGameScore(gameId, { periodKey, scoreRaw }, token);
    },
    onSuccess: async (_data, variables) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      // The home card + streak ride on today's My Games query even when the
      // score landed on a past day, so both get refreshed.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(gameId ?? "", variables.periodKey),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({
        message: variables.isEdit ? "Score updated" : "Score posted",
        tone: "success",
      });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: (periodKey: string) => {
      if (!gameId) throw new Error("missing game id");
      return clearGameScore(gameId, periodKey, token);
    },
    onSuccess: async (_data, periodKey) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(gameId ?? "", periodKey),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({ message: "Score cleared", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" });
    },
  });

  // Emoji reactions on friends' scores for the day being viewed (G2c).
  const reactionCtl = useScoreReactions<GameLeaderboardResponse>({
    periodKey: date,
    token,
    viewer: user ? { userId: user.id, displayName: user.displayName ?? null } : null,
    queryKey: queryKeys.games.leaderboard(gameId ?? "", date),
    readReactions: (data, _gameId, scoreUserId) =>
      data.entries.find((e) => e.userId === scoreUserId)?.reactions ?? [],
    writeReactions: (data, _gameId, scoreUserId, next) => ({
      ...data,
      entries: data.entries.map((e) => (e.userId === scoreUserId ? { ...e, reactions: next } : e)),
    }),
  });

  if (!gameId) {
    return (
      <Screen style={styles.center}>
        <EmptyState title="Missing game id" />
      </Screen>
    );
  }

  if (myGamesQuery.isPending) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </Screen>
    );
  }

  if (myGamesQuery.isError) {
    return (
      <Screen style={styles.center}>
        <EmptyState
          title="Couldn't load game"
          description={errorMessage(myGamesQuery.error)}
          action={
            <Button label="Retry" variant="secondary" onPress={() => myGamesQuery.refetch()} />
          }
        />
      </Screen>
    );
  }

  if (!game) {
    return (
      <Screen style={styles.center}>
        <EmptyState
          title="Game not found"
          description="This game isn't in My Games."
          action={
            <Button label="Back to Games" variant="secondary" onPress={() => goBack(routes.home)} />
          }
        />
      </Screen>
    );
  }

  const isToday = date === today;
  const entries = boardQuery.data?.entries ?? [];
  const myEntry = entries.find((e) => e.userId === user?.id);
  const otherEntries = entries.filter((e) => e.userId !== user?.id);
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  // The composer owns the my-slot when posting a first result OR editing an
  // existing one — on any day the rail can reach, not just today, so a
  // puzzle finished right after midnight still lands on the day it belongs to.
  const showComposer = !myScore || editingScore;
  const composerMode: "new" | "edit" = myScore ? "edit" : "new";
  const dateLabel = formatGameDateLabel(date, today);
  const host = (() => {
    if (!game.url) return null;
    try {
      return new URL(game.url).host.replace(/^www\./, "");
    } catch {
      return game.url;
    }
  })();

  const onDate = (key: string) => {
    setDate(key);
    setDraft("");
    setEditingScore(false);
  };

  const onSubmit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate({ scoreRaw: trimmed, periodKey: date, isEdit: editingScore });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen testID="game-board">
        <View style={styles.headerNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => goBack(routes.home)}
            testID="game-board-back"
            hitSlop={10}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <Text style={styles.navGlyph}>‹</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${game.title}`}
            accessibilityHint="Opens the game in your browser"
            onPress={() => openExternalUrl(game.url)}
            testID="game-board-title-link"
            style={({ pressed }) => [styles.titleBlock, pressed && styles.titleBlockPressed]}
          >
            {game.iconUrl ? (
              <Image
                source={{ uri: game.iconUrl }}
                style={styles.titleBadge}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.titleBadge, styles.titleBadgePlaceholder]}>
                <Text style={styles.titleBadgeGlyph}>🎮</Text>
              </View>
            )}
            <View style={styles.titleText}>
              <Text variant="title" numberOfLines={2} style={styles.titleName}>
                {game.title}
              </Text>
              {host ? (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {host}
                </Text>
              ) : null}
            </View>
            <View style={styles.titleOpenAffordance}>
              <Text style={styles.titleOpenGlyph}>↗</Text>
            </View>
          </Pressable>

          <DayRail
            selectedDate={date}
            today={today}
            onSelectDate={onDate}
            testIDPrefix="game-board-day"
          />

          <View style={styles.dayHeader}>
            <Text variant="heading" style={styles.dayTitle}>
              {formatGameDateLabel(date, today)}
            </Text>
            {boardQuery.isPending ? null : (
              <Text variant="caption" tone="muted">
                {entries.length === 0
                  ? isToday
                    ? "No plays yet."
                    : "No plays."
                  : `${entries.length} played`}
              </Text>
            )}
          </View>

          {boardQuery.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.accent.default} />
            </View>
          ) : boardQuery.isError ? (
            <View style={styles.scoresErrorBlock}>
              <Text tone="danger" style={styles.helper}>
                Couldn't load scores.
              </Text>
              <View style={styles.scoresErrorAction}>
                <Button
                  label="Try again"
                  variant="secondary"
                  size="md"
                  onPress={() => boardQuery.refetch()}
                  loading={boardQuery.isFetching}
                  testID="game-board-scores-retry"
                />
              </View>
            </View>
          ) : (
            <View style={styles.leaderboard}>
              {/* My slot is always at the top: the paste composer when I
                  haven't posted for this day (or am editing), else my entry. */}
              {showComposer ? (
                <ScoreComposer
                  mode={composerMode}
                  isToday={isToday}
                  dateLabel={dateLabel}
                  draft={draft}
                  baseline={myScore ?? ""}
                  onChangeDraft={setDraft}
                  onSubmit={onSubmit}
                  onCancel={() => {
                    setDraft("");
                    setEditingScore(false);
                  }}
                  pending={upsertMutation.isPending}
                  userName={user?.displayName ?? null}
                  userAvatarUrl={user?.avatarUrl ?? null}
                />
              ) : myEntry ? (
                <EntryRow
                  entry={myEntry}
                  game={game}
                  isMe
                  onEdit={() => {
                    setDraft(myEntry.scoreRaw ?? "");
                    setEditingScore(true);
                  }}
                  onClear={async () => {
                    const ok = await confirm({
                      title: isToday
                        ? "Clear your score for today?"
                        : `Clear your score for ${dateLabel}?`,
                      message: "Your result is removed. Scores on other days are kept.",
                      confirmLabel: "Clear",
                      destructive: true,
                    });
                    if (ok) clearMutation.mutate(date);
                  }}
                />
              ) : null}

              {otherEntries.map((entry) => (
                <EntryRow
                  key={entry.userId}
                  entry={entry}
                  game={game}
                  isMe={false}
                  onReact={(userId, emoji, currentlyReacted) =>
                    reactionCtl.react(gameId, userId, emoji, currentlyReacted)
                  }
                  onOpenReactionPicker={(userId) =>
                    reactionCtl.openPicker(gameId, userId, entry.displayName ?? null)
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>

        <ReactionPickerSheet
          visible={!!reactionCtl.target}
          targetName={reactionCtl.target?.name ?? null}
          current={reactionCtl.currentEmoji}
          onPick={reactionCtl.pick}
          onRemove={reactionCtl.removeReaction}
          onClose={reactionCtl.closePicker}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}

interface EntryRowProps {
  entry: GameStandingsEntry;
  game: Pick<Game, "title" | "url" | "summarySpec">;
  isMe: boolean;
  onEdit?: () => void;
  onClear?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

function EntryRow({
  entry,
  game,
  isMe,
  onEdit,
  onClear,
  onReact,
  onOpenReactionPicker,
}: EntryRowProps) {
  const name = entry.displayName ?? "Someone";
  // Same distillation as the home card (and the Lists clipboard recap): a
  // URL-only share formats to nothing → show "Played" rather than the link.
  const body = summarizeGameScoreBody(game, entry);
  // You react to friends' scores, not your own — so the controls only wire up
  // on other people's rows; your own row shows others' reactions read-only.
  const canReact = !isMe && !!onOpenReactionPicker;
  const showReactions = entry.reactions.length > 0 || canReact;
  return (
    <View style={[styles.entry, isMe && styles.entryMe]} testID={`game-board-row-${entry.userId}`}>
      <View style={styles.entryHeader}>
        {entry.rank != null ? (
          <View style={[styles.rankBadge, entry.rank === 1 && styles.rankBadgeTop1]}>
            <Text style={[styles.rankBadgeText, entry.rank === 1 && styles.rankBadgeTextTop1]}>
              {entry.rank}
            </Text>
          </View>
        ) : null}
        <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="md" />
        <View style={styles.entryNameWrap}>
          <View style={styles.entryNameRow}>
            <Text variant="label" style={styles.entryName} numberOfLines={1}>
              {name}
            </Text>
            {isMe ? (
              <View style={styles.youPill}>
                <Text style={styles.youPillText}>you</Text>
              </View>
            ) : null}
          </View>
          {entry.updatedAt ? (
            <Text variant="caption" tone="muted">
              Posted {formatRelative(entry.updatedAt)}
            </Text>
          ) : null}
        </View>
        {onEdit || onClear ? (
          <View style={styles.scoreActions}>
            {onEdit ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit your score"
                onPress={onEdit}
                testID="game-board-edit-score"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.scoreActionButton,
                  pressed && styles.editScorePressed,
                ]}
              >
                <Text style={styles.editScoreLabel}>Edit</Text>
              </Pressable>
            ) : null}
            {onClear ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear your score"
                onPress={onClear}
                testID="game-board-clear-score"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.scoreActionButton,
                  pressed && styles.clearScorePressed,
                ]}
              >
                <Text style={styles.clearScoreLabel}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.scoreRow}>
        <View style={styles.scoreFrame}>
          <Text
            style={[styles.scoreText, body ? null : styles.scoreTextMuted]}
            testID={`game-board-score-${entry.userId}`}
          >
            {body ?? "Played"}
          </Text>
        </View>
        {showReactions ? (
          <ScoreReactions
            reactions={entry.reactions}
            testIDPrefix={`game-board-react-${entry.userId}`}
            {...(canReact && onReact
              ? { onToggle: (emoji, cur) => onReact(entry.userId, emoji, cur) }
              : {})}
            {...(canReact && onOpenReactionPicker
              ? { onAdd: () => onOpenReactionPicker(entry.userId) }
              : {})}
          />
        ) : null}
      </View>
    </View>
  );
}

interface ScoreComposerProps {
  mode: "new" | "edit";
  /** Whether the board is showing today; past days get a dated caption. */
  isToday: boolean;
  /** "Today" / "Yesterday" / "Sep 4" — the day the paste will be filed under. */
  dateLabel: string;
  draft: string;
  baseline: string;
  onChangeDraft: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  userName: string | null;
  userAvatarUrl?: string | null;
}

// The my-slot in compose mode — posting a first result ("new") or fixing a
// botched paste in place ("edit"). Edit pre-fills the field and disables Save
// until the text actually changes. Clearing a posted score lives on the row's
// Edit/Clear pair (DELETE /v1/games/:id/scores/:periodKey), not in here.
function ScoreComposer({
  mode,
  isToday,
  dateLabel,
  draft,
  baseline,
  onChangeDraft,
  onSubmit,
  onCancel,
  pending,
  userName,
  userAvatarUrl,
}: ScoreComposerProps) {
  const isEdit = mode === "edit";
  const trimmed = draft.trim();
  const empty = trimmed.length === 0;
  const unchanged = isEdit && trimmed === baseline.trim();
  const canSubmit = !empty && !unchanged && !pending;
  // On web, Enter posts — results arrive via paste, so a newline keystroke is
  // almost never intentional (Shift+Enter still inserts one). RN-Web's
  // TextInput overwrites any custom onKeyDown with its own handler, which only
  // routes Enter to onSubmitEditing when blurOnSubmit is set on a multiline.
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
    <View style={[styles.entry, styles.entryMe]} testID="game-board-paste-slot">
      <View style={styles.entryHeader}>
        <Avatar name={userName} imageUrl={userAvatarUrl} size="md" />
        <View style={styles.entryNameWrap}>
          <View style={styles.entryNameRow}>
            <Text variant="label" style={styles.entryName}>
              {userName?.trim() || "You"}
            </Text>
            <View style={styles.youPill}>
              <Text style={styles.youPillText}>you</Text>
            </View>
          </View>
          <Text variant="caption" tone="muted">
            {isEdit
              ? isToday
                ? "Edit your result"
                : `Edit your result for ${dateLabel}`
              : isToday
                ? "Paste your result to play"
                : `Paste your result for ${dateLabel}`}
          </Text>
        </View>
      </View>
      <TextInput
        testID="game-board-paste-input"
        value={draft}
        onChangeText={onChangeDraft}
        placeholder={"Paste your result here"}
        placeholderTextColor={tokens.text.muted}
        multiline
        autoFocus={isEdit}
        maxLength={2000}
        style={styles.pasteInput}
        {...webProps}
      />
      <View style={styles.pasteActions}>
        {isEdit ? (
          <Button
            label="Cancel"
            variant="secondary"
            size="md"
            onPress={onCancel}
            disabled={pending}
            testID="game-board-edit-cancel"
          />
        ) : null}
        <Button
          label={isEdit ? "Save" : "Post score"}
          size="md"
          onPress={onSubmit}
          disabled={!canSubmit}
          loading={pending}
          testID="game-board-paste-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas, paddingTop: tokens.space.xl },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  navGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  body: {
    paddingBottom: tokens.space.xxl * 2,
    gap: tokens.space.lg,
  },
  titleBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.lg,
    paddingHorizontal: tokens.space.xl,
    paddingVertical: tokens.space.md,
    marginHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.lg,
  },
  titleBlockPressed: { backgroundColor: tokens.bg.surface },
  titleBadge: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.elevated,
  },
  titleBadgePlaceholder: { alignItems: "center", justifyContent: "center" },
  titleBadgeGlyph: { fontSize: 28, lineHeight: 32 },
  titleText: { flex: 1, minWidth: 0, gap: 4 },
  titleName: { letterSpacing: -0.5, fontSize: 28, lineHeight: 32 },
  titleOpenAffordance: {
    width: 32,
    height: 32,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.surface,
  },
  titleOpenGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.md,
    lineHeight: tokens.font.size.md + 2,
  },
  dayHeader: {
    paddingHorizontal: tokens.space.xl,
    gap: 2,
  },
  dayTitle: { letterSpacing: -0.2 },
  helper: {
    paddingVertical: tokens.space.lg,
    textAlign: "center",
    paddingHorizontal: tokens.space.xl,
  },
  scoresErrorBlock: {
    gap: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  scoresErrorAction: { alignItems: "center" },
  leaderboard: {
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.md,
  },
  entry: {
    gap: tokens.space.sm,
    paddingVertical: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.surface,
  },
  entryMe: {
    // Quiet accent tint as the sole "this is you" signal; the "you" pill
    // doubles as a textual label so the highlight isn't color-only.
    backgroundColor: `${tokens.accent.default}14`,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  entryNameWrap: { flex: 1, minWidth: 0, gap: 2 },
  entryNameRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  entryName: { fontSize: tokens.font.size.md, color: tokens.text.primary },
  scoreActions: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  scoreActionButton: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    borderRadius: tokens.radius.sm,
  },
  editScorePressed: { backgroundColor: tokens.accent.muted },
  editScoreLabel: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.accent.default,
  },
  // Clear is the quieter, destructive sibling of Edit: neutral text, neutral
  // press tint. The confirm dialog (and "Clear" wording) carry the weight, so
  // the control itself stays calm rather than a loud red on a daily screen.
  clearScorePressed: { backgroundColor: tokens.bg.elevated },
  clearScoreLabel: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.text.secondary,
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
  // Score box + reactions share one row so reactions sit to the right of the
  // score instead of below it (no extra row height).
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  scoreFrame: {
    flex: 1,
    minWidth: 0,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.canvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
  },
  rankBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
  },
  rankBadgeTop1: {
    backgroundColor: tokens.accent.default,
    borderColor: tokens.accent.default,
  },
  rankBadgeText: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.bold,
    color: tokens.text.secondary,
    fontVariant: ["tabular-nums"],
  },
  rankBadgeTextTop1: { color: tokens.text.onAccent },
  scoreText: {
    color: tokens.text.primary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 6,
  },
  scoreTextMuted: {
    color: tokens.text.muted,
    fontStyle: "italic",
  },
  pasteInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: tokens.font.size.sm,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: tokens.font.size.sm + 6,
  },
  pasteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xl,
  },
});
