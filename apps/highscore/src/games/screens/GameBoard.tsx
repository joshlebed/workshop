import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { HIGHSCORE_WEB_URL } from "@workshop/shared/constants";
import type { Game, GameStandingsEntry } from "@workshop/shared/games";
import { formatScoreValue, STREAK_MIN_DAYS } from "@workshop/shared/games";
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
import { ReportSheet, type ReportTarget } from "../../moderation/ReportSheet";
import {
  Avatar,
  Button,
  EmptyState,
  PixelIcon,
  Screen,
  scoreType,
  shareTextType,
  Text,
  tokens,
  useToast,
} from "../../theme";
import {
  clearGameScore,
  fetchGameLeaderboard,
  fetchMyGames,
  removeGame,
  upsertGameScore,
} from "../api/games";
import { setScoreDirection } from "../api/teach";
import { DAY_PICKER_LENGTH, DayPicker } from "../components/DayPicker";
import { ScoreCheckPanel } from "../components/ScoreCheckPanel";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { usePostedScoreNotice } from "../hooks/usePostedScoreNotice";
import { askScoreDirection } from "../lib/askScoreDirection";
import { formatGameDateLabel, resolveRailDate } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { writePostedScore } from "../lib/postedScore";
import { scoreLineLabel } from "../lib/scoreCheck";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { copyToClipboard } from "../lib/share";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { type ScorePostExtras, useScoreCheck, useTeachAvailable } from "../lib/useScoreCheck";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";

/**
 * Per-game board (G1b) — history for one game in My Games. The home card
 * owns today's standings; this screen is for paging back through past days
 * (header day picker) plus a paste slot for whichever day is showing.
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
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const notifyPosted = usePostedScoreNotice();

  const { today, viewDate: date, setViewDate } = useViewDay();
  // The selected day lives in the shared view-day state (state/viewDay.tsx),
  // so it sticks in both directions: arrive on the day home was showing, and
  // leave home on the day you paged to here. `?date=` (home card taps and
  // deep links) overrides the shared value once on mount; anything the rail
  // can't show → today.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only param sync
  useEffect(() => {
    if (params.date != null) {
      setViewDate(resolveRailDate(params.date, today, DAY_PICKER_LENGTH));
    }
  }, []);
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);
  // Teach v2: every read row states its score; the ranking footer.
  const teachAvailable = useTeachAvailable();

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
      // The home card + streak ride on today's My Games query even when the
      // score landed on a past day, so both get refreshed.
      const refresh = () =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: queryKeys.games.leaderboard(gameId ?? "", variables.periodKey),
          }),
          queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) }),
        ]);
      // The home card shows the posted row from the cache at once (a past
      // day's post is not on it); the board's own list refetches behind the toast.
      writePostedScore(queryClient, data, user);
      void refresh();
      notifyPosted({
        result: data,
        gameId: variables.postTo?.id ?? gameId ?? "",
        periodKey: variables.periodKey,
        scoreRaw: variables.scoreRaw,
        today,
        posted: variables.postTo
          ? `Posted to ${variables.postTo.title}`
          : variables.isEdit
            ? "Score updated"
            : "Score posted",
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

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeGame(id, token),
    onSuccess: async () => {
      haptics.medium();
      goBack(routes.home);
      await queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" });
    },
  });

  // Teach v2: whoever set a game's direction changes it outright; anyone
  // else's request waits for a second player asking for the same thing.
  const directionMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; title: string; to: "asc" | "desc" }) =>
      setScoreDirection(id, to, token),
    onSuccess: async (data, { title }) => {
      if (data.applied) await queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({
        message: data.applied
          ? `${title} now ranks ${data.game.scoreDirection === "asc" ? "lower" : "higher"} scores first.`
          : "Noted. It changes when one more player asks for the same.",
        tone: "success",
      });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't change the ranking"), tone: "danger" });
    },
  });

  // Guideline 1.2: long-press a friend's score to report it.
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

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
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  // The composer posts a first result OR edits an existing one — on any day
  // the picker can reach, not just today, so a puzzle finished right after
  // midnight still lands on the day it belongs to.
  const composerMode: "new" | "edit" = myScore ? "edit" : "new";
  const dateLabel = formatGameDateLabel(date, today);
  const streak = myGame?.standings.viewerStreak ?? 0;
  const playedToday = myGame?.standings.viewerHasPlayed ?? false;

  // Copy my own result as pasted, plus a HighScore link to bring friends in.
  const onCopyMine = async () => {
    if (!myScore) return;
    const ok = await copyToClipboard(`${myScore}\n\n${HIGHSCORE_WEB_URL}`);
    showToast(
      ok
        ? { message: "Copied your score", tone: "success" }
        : { message: "Couldn't copy", tone: "danger" },
    );
  };

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

  // The paste/edit slot: leads the board before I've posted, replaces my
  // row (at its rank) while editing.
  const composer = (
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
      onClear={async () => {
        const ok = await confirm({
          title: isToday ? "Clear your score for today?" : `Clear your score for ${dateLabel}?`,
          message: "Your result is removed. Scores on other days are kept.",
          confirmLabel: "Clear",
          destructive: true,
        });
        if (ok) clearMutation.mutate(date);
      }}
      pending={upsertMutation.isPending || clearMutation.isPending}
      userName={user?.displayName ?? null}
      userAvatarUrl={user?.avatarUrl ?? null}
    />
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen testID="game-board">
        {/* Compact pinned header: back · icon · title (+streak) · play · day ·
            copy · remove. */}
        <View style={styles.headerNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => goBack(routes.home)}
            testID="game-board-back"
            hitSlop={10}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <PixelIcon name="chevron-left" size={24} color={tokens.text.primary} />
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
            <Text variant="game" numberOfLines={1} style={styles.titleLabel}>
              {game.title}
            </Text>
            {streak >= STREAK_MIN_DAYS ? (
              <View
                style={styles.streak}
                accessibilityLabel={`${streak} day streak`}
                testID="game-board-streak"
              >
                <Text style={styles.streakDot}>·</Text>
                <Text style={styles.streakFlame}>🔥</Text>
                <Text style={styles.streakCount}>{streak}</Text>
              </View>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={playedToday ? `Play ${game.title} again` : `Play ${game.title}`}
            onPress={() => openExternalUrl(game.url)}
            testID="game-board-title-link"
            hitSlop={6}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <PixelIcon
              name="play"
              size={32}
              color={playedToday ? tokens.text.muted : tokens.neon.pink}
            />
          </Pressable>
          <DayPicker
            selectedDate={date}
            today={today}
            onSelectDate={onDate}
            testID="game-board-day-picker"
          />
          {myScore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy your score"
              onPress={onCopyMine}
              testID="game-board-copy"
              hitSlop={6}
              style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
            >
              <PixelIcon name="copy" size={24} color={tokens.text.secondary} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${game.title} from My Games`}
            onPress={async () => {
              const ok = await confirm({
                title: `Remove ${game.title} from My Games?`,
                message: "Your past scores stay — re-adding the game brings them back.",
                confirmLabel: "Remove",
                destructive: true,
              });
              if (ok && gameId) removeMutation.mutate(gameId);
            }}
            disabled={removeMutation.isPending}
            testID="game-board-remove"
            hitSlop={6}
            style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
          >
            <PixelIcon name="trash" size={24} color={tokens.text.secondary} />
          </Pressable>
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
              {/* Before I've posted for this day, the paste composer leads.
                  Once posted, my row sits at its rank among everyone else's;
                  editing swaps the composer in at that same spot. */}
              {myScore ? null : composer}
              {entries.map((entry) => {
                if (entry.userId === user?.id) {
                  if (!myScore) return null;
                  if (editingScore) return <View key={entry.userId}>{composer}</View>;
                  return (
                    <EntryRow
                      key={entry.userId}
                      entry={entry}
                      game={game}
                      teachAvailable={teachAvailable}
                      isMe
                      onPressPlayer={openProfile}
                      onEdit={() => {
                        setDraft(entry.scoreRaw ?? "");
                        setEditingScore(true);
                      }}
                    />
                  );
                }
                return (
                  <EntryRow
                    key={entry.userId}
                    entry={entry}
                    game={game}
                    teachAvailable={teachAvailable}
                    isMe={false}
                    onPressPlayer={openProfile}
                    onReport={() =>
                      setReportTarget({
                        userId: entry.userId,
                        name: entry.displayName ?? null,
                        kind: "score",
                        gameId,
                        periodKey: date,
                      })
                    }
                  />
                );
              })}
              {teachAvailable ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    directionMutation.mutate({
                      id: game.id,
                      title: game.title,
                      to: game.scoreDirection === "asc" ? "desc" : "asc",
                    })
                  }
                  disabled={directionMutation.isPending}
                  hitSlop={6}
                  style={styles.directionLink}
                  testID="game-board-direction"
                >
                  <Text variant="caption" tone="muted">
                    {game.scoreDirection === "asc" ? "Lower is better" : "Higher is better"}
                    {" · "}
                    <Text variant="caption" tone="muted" style={styles.directionChange}>
                      Change
                    </Text>
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </ScrollView>

        <ReportSheet target={reportTarget} token={token} onClose={() => setReportTarget(null)} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

interface EntryRowProps {
  entry: GameStandingsEntry;
  game: Pick<Game, "title" | "url" | "summarySpec" | "hasFormatter" | "scoreUnit">;
  /** Teach v2 is on for the viewer: every read row states its score. */
  teachAvailable: boolean;
  isMe: boolean;
  /** My row only: the pencil left of the score box opens the editor. */
  onEdit?: () => void;
  /** Long-press a friend's score → report it (Guideline 1.2). */
  onReport?: () => void;
  /** Tap the avatar or name → that player's profile. */
  onPressPlayer?: (userId: string) => void;
}

function EntryRow({
  entry,
  game,
  teachAvailable,
  isMe,
  onEdit,
  onReport,
  onPressPlayer,
}: EntryRowProps) {
  const name = entry.displayName ?? "Someone";
  // Same distillation as the home card (and the Lists clipboard recap): a
  // URL-only share formats to nothing → show "Played" rather than the link.
  const body = summarizeGameScoreBody(game, entry);
  // "adjusted": the player picked this score and the game's parser reads the
  // text differently. Tapping it shows the text as it was posted.
  const [showOriginal, setShowOriginal] = useState(false);
  const picked = scoreLineLabel(entry, game, teachAvailable);
  const scoreValue =
    entry.scoreValue != null && Number.isFinite(entry.scoreValue) ? entry.scoreValue : null;
  const openPlayer = onPressPlayer ? () => onPressPlayer(entry.userId) : undefined;
  return (
    <View style={styles.entry} testID={`game-board-row-${entry.userId}`}>
      <Pressable
        style={[styles.entryLine, isMe && styles.entryLineMe]}
        onLongPress={onReport}
        disabled={!onReport}
        accessibilityHint={onReport ? "Long-press to report this score" : undefined}
        testID={`game-board-score-row-${entry.userId}`}
      >
        <View style={styles.entryMain}>
          {/* Rank · avatar · "Name · 3h ago" on one centred line… */}
          <View style={styles.entryHead}>
            <View style={styles.rankSlot}>
              <Text
                style={
                  entry.rank == null
                    ? styles.rankDot
                    : [styles.rankText, entry.rank === 1 && styles.rankTextTop1]
                }
              >
                {entry.rank ?? "·"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${name}'s profile`}
              onPress={openPlayer}
              disabled={!openPlayer}
              hitSlop={4}
              style={({ pressed }) => [styles.entryAvatar, pressed && styles.entryIdentityPressed]}
              testID={`game-board-player-${entry.userId}`}
            >
              <Avatar
                name={entry.displayName}
                imageUrl={userAvatarImageUrl(entry.userId, entry.avatarVersion)}
                size="sm"
              />
            </Pressable>
            <View style={styles.entryHeadName}>
              <Pressable
                onPress={openPlayer}
                disabled={!openPlayer}
                style={({ pressed }) => [
                  styles.entryNamePress,
                  pressed && styles.entryIdentityPressed,
                ]}
              >
                <Text variant="label" style={styles.entryName} numberOfLines={1}>
                  {name}
                </Text>
              </Pressable>
              {entry.updatedAt ? (
                <Text variant="caption" tone="muted" numberOfLines={1} style={styles.entryAgo}>
                  · {formatRelative(entry.updatedAt)}
                </Text>
              ) : null}
            </View>
          </View>
          {/* …then the share text, indented under the name. */}
          <View style={styles.entryBody}>
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
                <Text variant="caption" tone="muted" testID={`game-board-picked-${entry.userId}`}>
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
        </View>
        {onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit your score"
            onPress={onEdit}
            testID="game-board-edit-score"
            hitSlop={8}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.editBtn,
              (pressed || hovered) && styles.editBtnHover,
            ]}
          >
            <PixelIcon name="pencil" size={16} color={tokens.text.secondary} />
          </Pressable>
        ) : null}
        {scoreValue !== null ? (
          <View style={styles.scoreBox} testID={`game-board-value-${entry.userId}`}>
            <Text style={styles.scoreBoxText}>{formatScoreValue(scoreValue, game.scoreUnit)}</Text>
          </View>
        ) : null}
      </Pressable>
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
  /** Edit mode: remove my score for this day. */
  onClear: () => void;
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
  gameId,
  periodKey,
  today,
  onSubmit,
  onPostToOther,
  onCancel,
  onClear,
  pending,
  userName,
  userAvatarUrl,
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
    <View style={styles.composer} testID="game-board-paste-slot">
      <View style={styles.entryHeader}>
        <Avatar name={userName} imageUrl={userAvatarUrl} size="md" />
        <View style={styles.entryNameWrap}>
          <View style={styles.entryNameRow}>
            <Text variant="label" style={styles.entryName}>
              {userName?.trim() || "You"}
            </Text>
          </View>
          {isEdit ? (
            <Text variant="caption" tone="muted">
              {isToday ? "Edit your result" : `Edit your result for ${dateLabel}`}
            </Text>
          ) : null}
        </View>
      </View>
      <TextInput
        testID="game-board-paste-input"
        value={draft}
        onChangeText={onChangeDraft}
        placeholder={"Paste your result here"}
        placeholderTextColor={tokens.text.secondary}
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
        {isEdit ? (
          <Button
            label="Clear"
            variant="secondary"
            size="md"
            onPress={onClear}
            disabled={pending}
            testID="game-board-clear-score"
          />
        ) : null}
        {isEdit || !empty ? (
          <Button
            label={isEdit ? "Save" : "Post score"}
            size="md"
            onPress={submit}
            disabled={!canSubmit}
            loading={pending}
            testID="game-board-paste-submit"
          />
        ) : null}
      </View>
    </View>
  );
}

// iOS Safari zooms the page when a focused input's font-size is under 16px,
// and never zooms back out on blur. Inputs are ≥16px everywhere (DESIGN.md).
const PASTE_INPUT_FONT_SIZE = tokens.font.size.md;

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
    borderRadius: tokens.radius.sm,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  body: {
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl * 2,
  },
  titleBadge: {
    width: 32,
    height: 32,
    borderRadius: tokens.radius.sm,
  },
  titleBadgePlaceholder: { alignItems: "center", justifyContent: "center" },
  // Emoji/glyph styles pin an explicit lineHeight ≥ fontSize — iOS clips a
  // glyph to the inherited line box otherwise (see app CLAUDE.md).
  titleBadgeGlyph: { fontSize: 18, lineHeight: 22 },
  titleText: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 },
  titleLabel: { flexShrink: 1 },
  // Streak: "· 🔥7" inline after the title, grey, no box.
  streak: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  // Emoji/glyph styles pin an explicit lineHeight ≥ fontSize — iOS clips a
  // glyph to the inherited (22px body) line box otherwise (see app CLAUDE.md).
  streakDot: { ...scoreType(10), lineHeight: 16, color: tokens.text.muted, marginRight: 4 },
  streakFlame: { fontSize: 12, lineHeight: 16 },
  // Streak counts are score numerals (pixel face).
  streakCount: {
    ...scoreType(10),
    lineHeight: 16,
    color: tokens.text.secondary,
  },
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
  },
  // Teach v2 ranking direction — a quiet footer, not a header control.
  directionLink: { alignSelf: "center", marginTop: tokens.space.lg, padding: tokens.space.xs },
  directionChange: { textDecorationLine: "underline" },
  // Rows mirror the home card's standings: rank · avatar · name/time over the
  // share text · boxed parsed score. No rules between rows.
  entry: { gap: tokens.space.xs, paddingVertical: tokens.space.xs },
  entryLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: 4,
    paddingHorizontal: tokens.space.xs,
    marginHorizontal: -tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  entryLineMe: { backgroundColor: tokens.accent.muted },
  entryAvatar: { borderRadius: tokens.radius.sm },
  // The paste composer (my slot before I've posted, or while editing).
  composer: { gap: tokens.space.sm, paddingVertical: tokens.space.md },
  entryHeader: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  entryNameWrap: { flex: 1, minWidth: 0, gap: 2 },
  entryIdentityPressed: { opacity: 0.6 },
  entryMain: { flex: 1, minWidth: 0, gap: tokens.space.sm },
  entryHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  entryHeadName: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xs,
  },
  // Indent = rank slot + gap: the text starts flush with the avatar's left edge.
  entryBody: { minWidth: 0, gap: 2, paddingLeft: 20 + tokens.space.sm },
  entryNameRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.xs },
  entryNamePress: { flexShrink: 1, minWidth: 0 },
  entryName: { fontSize: tokens.font.size.sm, color: tokens.text.primary },
  entryAgo: { flexShrink: 0 },
  rankSlot: { width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  rankText: { ...scoreType(10), color: tokens.text.muted },
  rankTextTop1: { color: tokens.neon.yellow },
  rankDot: { color: tokens.text.muted, fontSize: tokens.font.size.md },
  scoreBox: {
    flexShrink: 0,
    minWidth: 32,
    paddingHorizontal: tokens.space.sm,
    paddingVertical: 4,
    alignItems: "center",
    borderRadius: tokens.radius.sm,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  scoreBoxText: { ...scoreType(10), lineHeight: 14, color: tokens.text.primary },
  editBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  editBtnHover: { backgroundColor: tokens.bg.elevated },
  // Same share-text style as the home card's rows.
  scoreText: {
    color: tokens.text.secondary,
    ...shareTextType(tokens.font.size.xs),
  },
  scoreTextMuted: {
    color: tokens.text.muted,
    fontStyle: "italic",
  },
  pasteInput: {
    minHeight: 110,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: PASTE_INPUT_FONT_SIZE,
    backgroundColor: tokens.bg.elevated,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: PASTE_INPUT_FONT_SIZE + 6,
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
