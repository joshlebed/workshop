// Game board — "this day, one game, everyone". Same day spine as Home bound
// to the same global day; below it the full ranked board, your composer when
// you haven't posted, and the friends who have the game but haven't posted.
//
// Rules:
//   - Pasted scores upload to the bucket of the *selected* day, so a result
//     finished just after midnight can still be posted to "Yesterday". Edit
//     and Clear follow the same day.
//   - Going past today isn't offered (the spine disables it).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, GameLeaderboardResponse, GameStandingsEntry } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { confirm, formatRelative, haptics, openExternalUrl } from "@workshop/ui";
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
import { ScreenHeader } from "../../components/ScreenHeader";
import { DaySpine } from "../../day/DaySpine";
import { spineLabel } from "../../day/spine";
import { ReportSheet } from "../../moderation/ReportSheet";
import { useScoreReportFlow } from "../../moderation/useScoreReportFlow";
import {
  Avatar,
  Button,
  glow,
  IconButton,
  Notice,
  PixelIcon,
  Screen,
  Text,
  tokens,
  useToast,
} from "../../theme";
import {
  clearGameScore,
  fetchGameDiscovery,
  fetchGameLeaderboard,
  upsertGameScore,
} from "../api/games";
import { FixScoreSheet, type FixScoreTarget } from "../components/FixScoreSheet";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { ScoreCheckPanel } from "../components/ScoreCheckPanel";
import { ScoreReactions } from "../components/ScoreReactions";
import { useDayWindow } from "../hooks/useDayWindow";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { askScoreDirection } from "../lib/askScoreDirection";
import { scoredEntries, shortName } from "../lib/dayRows";
import { formatGameDateLabel, resolveRailDate } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { scoreLineLabel } from "../lib/scoreCheck";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { type ScorePostExtras, useScoreCheck, useTeachAvailable } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";

// `?date=` from a deep link may point anywhere in the past year.
const DEEP_LINK_DAYS = 366;

export default function GameBoard() {
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, user, routes } = useGamesRuntime();
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // The selected day is the app-wide value; `?date=` (home taps and deep
  // links) overrides it once on mount so a link lands where it points.
  const { viewDate: date, setViewDate } = useViewDay();
  const { today, playedDays, activeDays, byDay } = useDayWindow(date);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only param sync
  useEffect(() => {
    if (params.date != null) setViewDate(resolveRailDate(params.date, today, DEEP_LINK_DAYS));
  }, []);
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);
  const teachAvailable = useTeachAvailable();
  const [fixTarget, setFixTarget] = useState<FixScoreTarget | null>(null);

  // The catalog row comes from the My Games query (no `GET /v1/games/:id`);
  // any loaded day of the window carries it.
  const todayGames = byDay.get(today) ?? byDay.get(date) ?? byDay.values().next().value;
  const myGame = todayGames?.games.find((g) => g.gameId === gameId);
  const game = myGame?.game ?? null;
  const rotationPending = byDay.size === 0;

  const boardQuery = useQuery({
    queryKey: queryKeys.games.leaderboard(gameId ?? "", date),
    queryFn: () => fetchGameLeaderboard(gameId ?? "", date, token),
    enabled: !!token && !!gameId,
  });

  // Who has this game in their rotation — the "not yet" list is everyone in
  // there who hasn't posted for the day.
  const discoveryQuery = useQuery({
    queryKey: queryKeys.games.discovery(),
    queryFn: () => fetchGameDiscovery(token, { includeOwned: true }),
    enabled: !!token,
    staleTime: 60_000,
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
      extras?: ScorePostExtras;
      postTo?: { id: string; title: string };
    }) => {
      const target = postTo?.id ?? gameId;
      if (!target) throw new Error("missing game id");
      return upsertGameScore(
        target,
        { periodKey, scoreRaw, entrySource: "paste", ...extras?.body },
        token,
      );
    },
    onSuccess: async (data, variables) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.games.leaderboard(gameId ?? "", variables.periodKey),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(variables.periodKey) }),
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
        await Promise.all([
          refresh(),
          queryClient.invalidateQueries({ queryKey: ["game-score-check"] }),
        ]);
      }
      const message = teachOutcomeMessage(taught, variables.postTo?.title ?? game?.title ?? "");
      if (message) showToast({ message, tone: "success" });
    },
    onError: (e) => showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" }),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(periodKey) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
      ]);
      showToast({ message: "Score cleared", tone: "success" });
    },
    onError: (e) => showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" }),
  });

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

  // Day changes clear any half-typed draft (it belonged to the other day).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on day change only
  useEffect(() => {
    setDraft("");
    setEditingScore(false);
  }, [date]);

  if (!gameId) {
    return (
      <Screen style={styles.center}>
        <Notice title="Missing game id" />
      </Screen>
    );
  }
  if (rotationPending) {
    return (
      <Screen style={styles.center}>
        <ActivityIndicator color={tokens.neon.pink} />
      </Screen>
    );
  }
  if (!game) {
    return (
      <Screen style={styles.center}>
        <Notice
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
  const entries = scoredEntries(boardQuery.data?.entries ?? []);
  const myEntry = entries.find((e) => e.userId === user?.id);
  const ranked = entries
    .filter((e) => e.rank != null)
    .sort(
      (a, b) =>
        (a.rank ?? 0) - (b.rank ?? 0) || (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""),
    );
  const unranked = entries.filter((e) => e.rank == null);
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  const showComposer = !myScore || editingScore;
  const composerMode: "new" | "edit" = myScore ? "edit" : "new";
  const dateLabel = formatGameDateLabel(date, today);
  const streak = myGame?.standings.viewerStreak ?? 0;
  const postedIds = new Set(entries.map((e) => e.userId));
  const notYet =
    discoveryQuery.data?.games
      .find((g) => g.game.id === gameId)
      ?.friends.filter((f) => !postedIds.has(f.userId)) ?? [];
  const label = spineLabel(date, today);

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

  const composer = (
    <ScoreComposer
      mode={composerMode}
      isToday={isToday}
      dateLabel={dateLabel}
      draft={draft}
      baseline={myScore ?? ""}
      onChangeDraft={setDraft}
      gameId={gameId}
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
          extras: { body: { wrongGame: { gameId, choice: "there" } }, scoreDirection: null },
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
  );

  const renderEntry = (entry: GameStandingsEntry) => {
    const isMe = entry.userId === user?.id;
    return (
      <EntryRow
        key={entry.userId}
        entry={entry}
        game={game}
        teachAvailable={teachAvailable}
        isMe={isMe}
        onPressPlayer={openProfile}
        {...(isMe
          ? {
              onEdit: () => {
                setDraft(entry.scoreRaw ?? "");
                setEditingScore(true);
              },
              onClear: async () => {
                const ok = await confirm({
                  title: isToday
                    ? "Clear your score for today?"
                    : `Clear your score for ${dateLabel}?`,
                  message: "Your result is removed. Scores on other days are kept.",
                  confirmLabel: "Clear",
                  destructive: true,
                });
                if (ok) clearMutation.mutate(date);
              },
              ...(teachAvailable && myScore
                ? {
                    onFix: () =>
                      setFixTarget({
                        gameId,
                        gameTitle: game.title,
                        periodKey: date,
                        scoreRaw: myScore,
                      }),
                  }
                : {}),
            }
          : {
              onReact: (userId: string, emoji: string, currentlyReacted: boolean) =>
                reactionCtl.react(gameId, userId, emoji, currentlyReacted),
              onOpenReactionPicker: (userId: string) =>
                reactionCtl.openPicker(gameId, userId, entry.displayName ?? null),
            })}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen testID="game-board">
        <ScreenHeader
          onBack={() => goBack(routes.home)}
          backTestID="game-board-back"
          title={game.title}
          left={
            game.iconUrl ? (
              <Image
                source={{ uri: game.iconUrl }}
                style={styles.titleBadge}
                accessibilityIgnoresInvertColors
              />
            ) : null
          }
          right={
            <>
              {streak >= STREAK_MIN_DAYS ? (
                <Text variant="caption" tone="success" testID="game-board-streak">
                  🔥{streak}
                </Text>
              ) : null}
              <IconButton
                accessibilityLabel={`Open ${game.title} in your browser`}
                onPress={() => openExternalUrl(game.url)}
                testID="game-board-title-link"
              >
                <PixelIcon name="external-link" color={tokens.neon.pink} />
              </IconButton>
            </>
          }
        />
        <View style={styles.spine}>
          <DaySpine playedDays={playedDays} activeDays={activeDays} testIDPrefix="game-board-day" />
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text
            variant="caption"
            tone="secondary"
            testID="game-board-turnout"
            style={styles.turnout}
          >
            {boardQuery.isPending
              ? label.absolute
              : entries.length === 0
                ? isToday
                  ? "No plays yet"
                  : "No plays"
                : `${entries.length} played`}
          </Text>

          {boardQuery.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.neon.pink} />
            </View>
          ) : boardQuery.isError ? (
            <Notice
              title="Couldn't load scores"
              action={
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => void boardQuery.refetch()}
                  loading={boardQuery.isFetching}
                  testID="game-board-scores-retry"
                />
              }
            />
          ) : (
            <View style={styles.board}>
              {showComposer ? composer : null}
              {ranked.map(renderEntry)}
              {unranked.length > 0 ? (
                <>
                  <Text variant="heading" tone="secondary" style={styles.sectionLabel}>
                    Unranked
                  </Text>
                  {unranked.map(renderEntry)}
                </>
              ) : null}
              {notYet.length > 0 ? (
                <View style={styles.notYet} testID="game-board-not-yet">
                  <Text variant="heading" tone="secondary" style={styles.sectionLabel}>
                    {isToday ? "Not yet" : "Didn't play"}
                  </Text>
                  <View style={styles.notYetRow}>
                    {notYet.map((f) => (
                      <Pressable
                        key={f.userId}
                        accessibilityRole="button"
                        accessibilityLabel={`${f.displayName ?? "Player"}'s profile`}
                        onPress={() => openProfile(f.userId)}
                        style={styles.notYetChip}
                      >
                        <Avatar
                          name={f.displayName}
                          imageUrl={userAvatarImageUrl(f.userId)}
                          size="sm"
                        />
                        <Text variant="caption" tone="secondary">
                          {shortName(f.displayName)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : entries.length <= 1 && !discoveryQuery.isPending ? (
                <Text variant="caption" tone="secondary" style={styles.sectionLabel}>
                  No friends play this yet — invite them from your profile.
                </Text>
              ) : null}
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
  teachAvailable: boolean;
  isMe: boolean;
  onEdit?: () => void;
  onClear?: () => void;
  onFix?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
  onPressPlayer?: (userId: string) => void;
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
  onPressPlayer,
}: EntryRowProps) {
  const name = entry.displayName ?? "Someone";
  const body = summarizeGameScoreBody(game, entry);
  const [showOriginal, setShowOriginal] = useState(false);
  const picked = scoreLineLabel(entry, game, teachAvailable);
  const canReact = !isMe && !!onOpenReactionPicker;
  const showReactions = entry.reactions.length > 0 || canReact;
  const top = entry.rank === 1;
  return (
    <View style={[styles.entry, isMe && styles.entryMe]} testID={`game-board-row-${entry.userId}`}>
      <View style={styles.entryHeader}>
        <View style={styles.rank}>
          <Text
            variant="score"
            tone={top ? "spotlight" : entry.rank == null ? "secondary" : "primary"}
            style={styles.rankText}
          >
            {entry.rank == null ? "—" : top ? "👑" : String(entry.rank)}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}
          accessibilityRole="button"
          accessibilityLabel={`View ${name}'s profile`}
          onPress={onPressPlayer ? () => onPressPlayer(entry.userId) : undefined}
          disabled={!onPressPlayer}
          testID={`game-board-player-${entry.userId}`}
        >
          <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="md" />
          <View style={styles.nameWrap}>
            <Text variant="label" numberOfLines={1}>
              {name}
              {isMe ? (
                <Text variant="caption" tone="link">
                  {"  you"}
                </Text>
              ) : null}
            </Text>
            {entry.updatedAt ? (
              <Text variant="caption" tone="secondary">
                {formatRelative(entry.updatedAt)}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {onEdit || onClear || onFix ? (
          <View style={styles.actions}>
            {onFix ? <ActionKey label="Fix" onPress={onFix} testID="game-board-fix-score" /> : null}
            {onEdit ? (
              <ActionKey label="Edit" onPress={onEdit} testID="game-board-edit-score" />
            ) : null}
            {onClear ? (
              <ActionKey label="Clear" onPress={onClear} testID="game-board-clear-score" danger />
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.scoreRow}>
        <Text
          style={[styles.scoreText, !body && styles.scoreTextMuted]}
          testID={`game-board-score-${entry.userId}`}
        >
          {body ?? "Played"}
        </Text>
        {picked ? (
          <View style={styles.pickedRow}>
            <Text variant="caption" testID={`game-board-picked-${entry.userId}`}>
              {picked}
            </Text>
            {entry.adjusted ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Adjusted score. Show the original text"
                onPress={() => setShowOriginal((s) => !s)}
                hitSlop={8}
                testID={`game-board-adjusted-${entry.userId}`}
              >
                <Text variant="caption" tone="secondary" style={styles.adjusted}>
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

function ActionKey({
  label,
  onPress,
  testID,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} your score`}
      onPress={onPress}
      testID={testID}
      hitSlop={6}
      style={({ pressed }) => [styles.actionKey, pressed && styles.actionKeyPressed]}
    >
      <Text variant="caption" tone={danger ? "danger" : "link"}>
        {label}
      </Text>
    </Pressable>
  );
}

interface ScoreComposerProps {
  mode: "new" | "edit";
  isToday: boolean;
  dateLabel: string;
  draft: string;
  baseline: string;
  onChangeDraft: (v: string) => void;
  gameId: string | null;
  periodKey: string;
  today: string;
  onSubmit: (extras?: ScorePostExtras) => void;
  onPostToOther: (other: { id: string; title: string }) => void;
  onCancel: () => void;
  pending: boolean;
  userName: string | null;
  userAvatarUrl?: string | null;
  onPlay?: () => void;
}

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
  const check = useScoreCheck({ gameId, text: draft, periodKey, entry: "paste", today });
  const blocked = check.available && !check.canPost;
  const canSubmit = !empty && !unchanged && !pending && !blocked;
  const submit = () => onSubmit(check.available ? check.extras() : undefined);
  const [focused, setFocused] = useState(false);
  // On web, Enter posts — results arrive via paste, so a newline keystroke is
  // almost never intentional. RN-Web only routes Enter to onSubmitEditing on
  // a multiline when blurOnSubmit is set.
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
    <View style={styles.composer} testID="game-board-paste-slot">
      <View style={styles.entryHeader}>
        <Avatar name={userName} imageUrl={userAvatarUrl} size="md" />
        <View style={styles.nameWrap}>
          <Text variant="label" numberOfLines={1}>
            {userName?.trim() || "You"}
          </Text>
          <Text variant="caption" tone="secondary">
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
        placeholder="Paste your result here"
        placeholderTextColor={tokens.text.secondary}
        multiline
        autoFocus={isEdit}
        maxLength={2000}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, focused && styles.inputFocused]}
        {...webProps}
      />
      <ScoreCheckPanel
        check={check}
        testID="game-board-check"
        onPostToOther={(id, title) => onPostToOther({ id, title })}
      />
      <View style={styles.composerActions}>
        {onPlay ? (
          <Button label="Play" variant="secondary" onPress={onPlay} testID="game-board-play" />
        ) : null}
        {isEdit ? (
          <Button
            label="Cancel"
            variant="secondary"
            onPress={onCancel}
            disabled={pending}
            testID="game-board-edit-cancel"
          />
        ) : null}
        <Button
          label={isEdit ? "Save" : "Post score"}
          onPress={submit}
          disabled={!canSubmit}
          loading={pending}
          testID="game-board-paste-submit"
          style={styles.composerSubmit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
  titleBadge: {
    width: 24,
    height: 24,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  spine: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xs,
    paddingBottom: tokens.space.xs,
    backgroundColor: tokens.bg.canvas,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.bg.elevated,
    zIndex: 1,
  },
  body: { paddingBottom: tokens.space.xxl },
  turnout: { paddingHorizontal: tokens.space.lg, paddingVertical: tokens.space.sm },
  board: {},
  sectionLabel: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xs,
    fontSize: 9,
    lineHeight: 14,
  },
  entry: {
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    gap: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.bg.elevated,
    borderLeftWidth: tokens.bezel,
    borderLeftColor: "transparent",
  },
  entryMe: { borderLeftColor: tokens.neon.pink, backgroundColor: tokens.bg.surface },
  entryHeader: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  rank: { width: 28, alignItems: "center" },
  rankText: { fontSize: 12, lineHeight: 18 },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
  identityPressed: { opacity: 0.7 },
  nameWrap: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", gap: tokens.space.xs },
  actionKey: {
    paddingHorizontal: tokens.space.sm,
    paddingVertical: tokens.space.xs,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  actionKeyPressed: { backgroundColor: tokens.bg.raised },
  scoreRow: { paddingLeft: 28 + tokens.space.md, gap: tokens.space.xs },
  scoreText: { color: tokens.text.primary, fontSize: 15, lineHeight: 21 },
  scoreTextMuted: { color: tokens.text.secondary, fontStyle: "italic" },
  pickedRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  adjusted: { textDecorationLine: "underline" },
  composer: {
    margin: tokens.space.lg,
    marginTop: tokens.space.xs,
    padding: tokens.space.md,
    gap: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    backgroundColor: tokens.bg.surface,
    ...glow(tokens.neon.pinkGlow, 6),
  },
  input: {
    minHeight: 88,
    textAlignVertical: "top",
    padding: tokens.space.md,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.elevated,
    color: tokens.text.primary,
    fontSize: 15,
    lineHeight: 21,
  },
  inputFocused: { borderColor: tokens.neon.pink },
  composerActions: { flexDirection: "row", gap: tokens.space.sm, justifyContent: "flex-end" },
  composerSubmit: { flexGrow: 1 },
  notYet: { gap: tokens.space.xs },
  notYetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
  },
  notYetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
    paddingRight: tokens.space.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
});
