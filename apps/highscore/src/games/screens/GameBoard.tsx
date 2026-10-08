import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, GameLeaderboardResponse, GameStandingsEntry } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
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
import { useEffect, useState } from "react";
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
import { ReportSheet } from "../../moderation/ReportSheet";
import { useScoreReportFlow } from "../../moderation/useScoreReportFlow";
import { clearGameScore, fetchGameLeaderboard, fetchMyGames, upsertGameScore } from "../api/games";
import { DAY_RAIL_DEFAULT_LENGTH, DayRail } from "../components/DayRail";
import { FixScoreSheet, type FixScoreTarget } from "../components/FixScoreSheet";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { ScoreCheckPanel } from "../components/ScoreCheckPanel";
import { ScoreReactions } from "../components/ScoreReactions";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { askScoreDirection } from "../lib/askScoreDirection";
import { daysBack, formatGameDateLabel, localDateKey, resolveRailDate } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { scoreLineLabel } from "../lib/scoreCheck";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { type ScorePostExtras, useScoreCheck, useTeachAvailable } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";

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
  // The selected day lives in the shared view-day state (state/viewDay.tsx),
  // so it sticks in both directions: arrive on the day home was showing, and
  // leave home on the day you paged to here. `?date=` (home card taps and
  // deep links) overrides the shared value once on mount; anything the rail
  // can't show → today.
  const { viewDate: date, setViewDate } = useViewDay();
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only param sync
  useEffect(() => {
    if (params.date != null) {
      setViewDate(resolveRailDate(params.date, today, DAY_RAIL_DEFAULT_LENGTH));
    }
  }, []);
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);
  // "Earlier" pages the rail back a week at a time; the rail also grows to
  // cover a selection inherited from home (never shrinks below it).
  const [railPages, setRailPages] = useState(1);
  const railLength = Math.max(railPages * DAY_RAIL_DEFAULT_LENGTH, daysBack(date, today) + 1);
  // Teach v2: "Fix score" on my own row. Absent without the capability.
  const teachAvailable = useTeachAvailable();
  const [fixTarget, setFixTarget] = useState<FixScoreTarget | null>(null);

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
      extras,
      postTo,
    }: {
      scoreRaw: string;
      periodKey: string;
      isEdit: boolean;
      /** Teach v2: the pick and what the user answered about the preview. */
      extras?: ScorePostExtras;
      /** Teach v2: "Post to <other game>" on a wrong-game warning. */
      postTo?: { id: string; title: string };
    }) => {
      const target = postTo?.id ?? gameId;
      if (!target) throw new Error("missing game id");
      return upsertGameScore(target, { periodKey, scoreRaw, ...extras?.body }, token);
    },
    onSuccess: async (data, variables) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      // The home card + streak ride on today's My Games query even when the
      // score landed on a past day, so both get refreshed.
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.games.leaderboard(gameId ?? "", variables.periodKey),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
        ]);
      await refresh();
      showToast({
        message: variables.postTo
          ? `Posted to ${variables.postTo.title}`
          : variables.isEdit
            ? "Score updated"
            : "Score posted",
        tone: "success",
      });
      // A pick that can teach the game does so once the post has landed.
      const taughtGameId = variables.postTo?.id ?? gameId;
      if (!taughtGameId) return;
      const taught = await teachAfterPost({
        gameId: taughtGameId,
        periodKey: variables.periodKey,
        hint: data.teach,
        scoreDirection: variables.extras?.scoreDirection ?? null,
        askDirection: askScoreDirection(variables.postTo?.title ?? game?.title ?? "this game"),
        token,
      });
      if (taught) {
        // A taught game reads texts differently: cached previews are stale.
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ["game-score-check"] }),
        ]);
      }
      const message = teachOutcomeMessage(taught, variables.postTo?.title ?? game?.title ?? "");
      if (message) showToast({ message, tone: "success" });
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
  const reportFlow = useScoreReportFlow(reactionCtl.closePicker);

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
  const streak = myGame?.standings.viewerStreak ?? 0;
  // One quiet line says where you are and how busy the day was — the rail's
  // selected chip already restates the day, so no big day heading.
  const turnout =
    entries.length === 0 ? (isToday ? "No plays yet" : "No plays") : `${entries.length} played`;

  const onDate = (key: string) => {
    setViewDate(key);
    setDraft("");
    setEditingScore(false);
  };

  const onSubmit = (extras?: ScorePostExtras) => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate({
      scoreRaw: trimmed,
      periodKey: date,
      isEdit: editingScore,
      ...(extras ? { extras } : {}),
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen testID="game-board">
        {/* Compact pinned header: back · icon · title (+streak) · open-game.
            The day rail below never scrolls away — it's the screen's primary
            control. */}
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
            <Text variant="heading" numberOfLines={1} style={styles.titleName}>
              {game.title}
            </Text>
          </View>
          {streak >= STREAK_MIN_DAYS ? (
            <View style={styles.streak} testID="game-board-streak">
              <Text style={styles.streakFlame}>🔥</Text>
              <Text style={styles.streakCount}>{streak}</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open ${game.title} in your browser`}
            onPress={() => openExternalUrl(game.url)}
            testID="game-board-title-link"
            hitSlop={6}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <Text style={styles.titleOpenGlyph}>↗</Text>
          </Pressable>
        </View>

        <View style={styles.dayRail}>
          <DayRail
            selectedDate={date}
            today={today}
            onSelectDate={onDate}
            length={railLength}
            onExtend={() => setRailPages((p) => p + 1)}
            testIDPrefix="game-board-day"
          />
        </View>

        <View style={styles.dayHeader}>
          <Text variant="caption" tone="muted" testID="game-board-turnout">
            {boardQuery.isPending ? dateLabel : `${dateLabel} · ${turnout}`}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
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
                  gameId={gameId ?? null}
                  periodKey={date}
                  today={today}
                  onSubmit={onSubmit}
                  onPostToOther={(other) => {
                    const trimmed = draft.trim();
                    if (trimmed.length === 0) return;
                    upsertMutation.mutate({
                      scoreRaw: trimmed,
                      periodKey: date,
                      isEdit: false,
                      postTo: other,
                      extras: {
                        body: { wrongGame: { gameId: gameId ?? other.id, choice: "there" } },
                        scoreDirection: null,
                      },
                    });
                  }}
                  onCancel={() => {
                    setDraft("");
                    setEditingScore(false);
                  }}
                  pending={upsertMutation.isPending}
                  userName={user?.displayName ?? null}
                  userAvatarUrl={user?.avatarUrl ?? null}
                  {...(composerMode === "new" && isToday && game.url
                    ? { onPlay: () => openExternalUrl(game.url) }
                    : {})}
                />
              ) : myEntry ? (
                <EntryRow
                  entry={myEntry}
                  game={game}
                  teachAvailable={teachAvailable}
                  isMe
                  onEdit={() => {
                    setDraft(myEntry.scoreRaw ?? "");
                    setEditingScore(true);
                  }}
                  {...(teachAvailable && myScore && gameId
                    ? {
                        onFix: () =>
                          setFixTarget({
                            gameId,
                            gameTitle: game.title,
                            periodKey: date,
                            scoreRaw: myScore,
                          }),
                      }
                    : {})}
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
                  teachAvailable={teachAvailable}
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
          onClosed={reportFlow.onPickerClosed}
          onReport={() => {
            const t = reactionCtl.target;
            if (!t) return;
            reportFlow.requestReport({
              userId: t.scoreUserId,
              name: t.name,
              kind: "score",
              gameId: t.gameId,
              periodKey: date,
            });
          }}
        />
        <ReportSheet target={reportFlow.target} token={token} onClose={reportFlow.close} />
        <FixScoreSheet target={fixTarget} today={today} onClose={() => setFixTarget(null)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

interface EntryRowProps {
  entry: GameStandingsEntry;
  game: Pick<Game, "title" | "url" | "summarySpec" | "hasFormatter">;
  /** Teach v2 is on for the viewer: every read row states its score. */
  teachAvailable: boolean;
  isMe: boolean;
  onEdit?: () => void;
  onClear?: () => void;
  /** Teach v2 "Fix score" — the poster's own row only. */
  onFix?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

function EntryRow({
  entry,
  game,
  teachAvailable,
  isMe,
  onEdit,
  onClear,
  onFix,
  onReact,
  onOpenReactionPicker,
}: EntryRowProps) {
  const name = entry.displayName ?? "Someone";
  // Same distillation as the home card (and the Lists clipboard recap): a
  // URL-only share formats to nothing → show "Played" rather than the link.
  const body = summarizeGameScoreBody(game, entry);
  // "adjusted": the player picked this score and the game's parser reads the
  // text differently. Tapping it shows the text as it was posted.
  const [showOriginal, setShowOriginal] = useState(false);
  const picked = scoreLineLabel(entry, game, teachAvailable);
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
        {onEdit || onClear || onFix ? (
          <View style={styles.scoreActions}>
            {onFix ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fix your score"
                onPress={onFix}
                testID="game-board-fix-score"
                hitSlop={8}
                style={({ pressed }) => [
                  styles.scoreActionButton,
                  pressed && styles.editScorePressed,
                ]}
              >
                <Text style={styles.editScoreLabel}>Fix score</Text>
              </Pressable>
            ) : null}
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
          {/* A picked score is not necessarily legible in the text above, so
              say what counts — and flag it while the parser reads otherwise. */}
          {picked ? (
            <View style={styles.pickedRow}>
              <Text variant="label" testID={`game-board-picked-${entry.userId}`}>
                {picked}
              </Text>
              {entry.adjusted ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Adjusted score. Show the original text"
                  onPress={() => setShowOriginal((shown) => !shown)}
                  hitSlop={8}
                  testID={`game-board-adjusted-${entry.userId}`}
                >
                  <Text variant="caption" tone="muted" style={styles.adjustedLabel}>
                    adjusted
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {entry.adjusted && showOriginal ? (
            <Text
              style={[styles.scoreText, styles.scoreTextMuted]}
              testID={`game-board-original-${entry.userId}`}
            >
              {entry.scoreRaw}
            </Text>
          ) : null}
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
  gameId: string | null;
  /** The day the paste is filed under. */
  periodKey: string;
  today: string;
  /** `extras` is set for a teach v2 account. */
  onSubmit: (extras?: ScorePostExtras) => void;
  onPostToOther: (other: { id: string; title: string }) => void;
  onCancel: () => void;
  pending: boolean;
  userName: string | null;
  userAvatarUrl?: string | null;
  /** Today-only: opens the game so there's a result to paste. */
  onPlay?: () => void;
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
  gameId,
  periodKey,
  today,
  onSubmit,
  onPostToOther,
  onCancel,
  pending,
  userName,
  userAvatarUrl,
  onPlay,
}: ScoreComposerProps) {
  const isEdit = mode === "edit";
  const trimmed = draft.trim();
  const empty = trimmed.length === 0;
  const unchanged = isEdit && trimmed === baseline.trim();
  // Teach v2: what the post will record, and the picker when nothing read it.
  // Off (and silent) for an account without the capability.
  const check = useScoreCheck({ gameId, text: draft, periodKey, entry: "paste", today });
  const blocked = check.available && !check.canPost;
  const canSubmit = !empty && !unchanged && !pending && !blocked;
  const submit = () => onSubmit(check.available ? check.extras() : undefined);
  // On web, Enter posts — results arrive via paste, so a newline keystroke is
  // almost never intentional (Shift+Enter still inserts one). RN-Web's
  // TextInput overwrites any custom onKeyDown with its own handler, which only
  // routes Enter to onSubmitEditing when blurOnSubmit is set on a multiline.
  const webProps =
    Platform.OS === "web"
      ? {
          blurOnSubmit: true,
          onSubmitEditing: () => {
            if (canSubmit) submit();
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
      <ScoreCheckPanel
        check={check}
        testID="game-board-check"
        onPostToOther={(id, title) => onPostToOther({ id, title })}
      />
      <View style={styles.pasteActions}>
        {onPlay ? (
          <Button
            label="Play"
            variant="secondary"
            size="md"
            onPress={onPlay}
            testID="game-board-play"
          />
        ) : null}
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
          onPress={submit}
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
  adjustedLabel: { fontStyle: "italic", textDecorationLine: "underline" },
  pickedRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: tokens.space.sm,
    marginTop: tokens.space.xs,
  },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingLeft: tokens.space.sm,
    paddingRight: tokens.space.md,
    paddingBottom: tokens.space.md,
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
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl * 2,
  },
  titleBadge: {
    width: 32,
    height: 32,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  titleBadgePlaceholder: { alignItems: "center", justifyContent: "center" },
  // Emoji/glyph styles pin an explicit lineHeight ≥ fontSize — iOS clips a
  // glyph to the inherited line box otherwise (see app CLAUDE.md).
  titleBadgeGlyph: { fontSize: 18, lineHeight: 22 },
  titleText: { flex: 1, minWidth: 0 },
  titleName: { letterSpacing: -0.3 },
  titleOpenGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.lg,
    lineHeight: tokens.font.size.lg + 2,
  },
  // Streak pill mirrors the home card's (StandingsCard) so the flame reads as
  // the same signal on both surfaces; static here — Play lives in the my-slot.
  streak: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: tokens.radius.pill,
    backgroundColor: `${tokens.accent.default}1F`,
  },
  streakFlame: { fontSize: 12, lineHeight: 16 },
  streakCount: {
    fontSize: tokens.font.size.xs,
    lineHeight: 16,
    fontWeight: tokens.font.weight.bold,
    color: tokens.accent.default,
    fontVariant: ["tabular-nums"],
  },
  dayRail: { paddingBottom: tokens.space.sm },
  dayHeader: { paddingHorizontal: tokens.space.xl },
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
