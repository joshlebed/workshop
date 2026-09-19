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
import {
  clearGameScore,
  fetchGameLeaderboard,
  fetchMyGames,
  setGameScoreSpec,
  upsertGameScore,
} from "../api/games";
import { DayRail } from "../components/DayRail";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { ScoreReactions } from "../components/ScoreReactions";
import { useReturnToPaste } from "../hooks/useReturnToPaste";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { daysBack, formatGameDateLabel, localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { isGameReteachable, specForGame } from "../lib/scoreSpecs";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";
import { useViewDay } from "../state/viewDay";
import { GameScorePasteSheet, type TaughtScoreSpec } from "./GameScorePasteSheet";

/**
 * Per-game board (G1b) — history for one game in My Games. The home card
 * owns today's standings; this screen is for paging back through past days
 * (DayRail) plus the same play→paste loop home has, so today is still
 * postable from here.
 *
 * Spec rules (mirrors the home cards):
 *   - Pasted scores always upload to *today's* bucket regardless of which
 *     day the board is showing.
 *   - Going past today on the day rail isn't offered.
 *   - The selected day is shared with home (state/viewDay.tsx): arrive on the
 *     day home was showing, and leave home on the day you paged to here.
 */
export default function GameBoard() {
  const params = useLocalSearchParams<{ id: string }>();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, user, routes } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  const { viewDate: date, setViewDate } = useViewDay();
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);
  // "Earlier" pages the rail back a week at a time; the rail also grows to
  // cover a selection inherited from home (never shrinks below it).
  const [railPages, setRailPages] = useState(1);
  const railLength = Math.max(railPages * 7, daysBack(date, today) + 1);

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

  // Play-then-paste loop — same machinery as home, but its own scope: the
  // home instance stays mounted underneath this pushed screen, and two
  // instances prompting on one pending play would stack two Modals (iOS
  // wedge, see CLAUDE.md). A play armed here prompts here; one armed on home
  // prompts on home.
  const { promptItemId, markPlaying, openPasteFor, dismiss } = useReturnToPaste({
    todayKey: today,
    // Another board's pending play isn't ours to drop — report "no score" so
    // the pending survives until that game's board (same scope) picks it up.
    hasScoreForItem: (itemId) =>
      itemId === gameId ? (myGame?.standings.viewerHasPlayed ?? false) : false,
    scope: "games-board",
  });
  const pasteTarget: Game | null = (promptItemId === gameId ? game : null) ?? null;

  const upsertMutation = useMutation({
    // `taught` (the tap-the-score flow, see GameScorePasteSheet) stores the
    // learned parser on the game first, so this very post parses with it.
    mutationFn: async ({
      scoreRaw,
      taught,
    }: {
      scoreRaw: string;
      isEdit: boolean;
      taught?: TaughtScoreSpec;
    }) => {
      if (!gameId) throw new Error("missing game id");
      if (taught) await setGameScoreSpec(gameId, taught, token);
      return upsertGameScore(gameId, { periodKey: today, scoreRaw }, token);
    },
    onSuccess: async (_data, variables) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      dismiss();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(gameId ?? "", today),
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
    mutationFn: () => {
      if (!gameId) throw new Error("missing game id");
      return clearGameScore(gameId, today, token);
    },
    onSuccess: async () => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.games.leaderboard(gameId ?? "", today),
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
  const streak = myGame?.standings.viewerStreak ?? 0;
  // One line says where you are and how busy the day was — the rail's
  // selected chip already restates the day, so keep this quiet.
  const turnout =
    entries.length === 0 ? (isToday ? "No plays yet" : "No plays") : `${entries.length} played`;

  const onDate = (key: string) => {
    setViewDate(key);
    setDraft("");
    setEditingScore(false);
  };

  const onSubmitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate({ scoreRaw: trimmed, isEdit: true });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen testID="game-board">
        {/* Compact header: back · icon · title (+streak) · open-game. Pinned,
            like home's header — the day rail below never scrolls away. */}
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
            {boardQuery.isPending
              ? formatGameDateLabel(date, today)
              : `${formatGameDateLabel(date, today)} · ${turnout}`}
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
              {/* My slot is always at the top: my filled entry (with in-place
                  edit), the play CTA on an unplayed today, or a quiet "didn't
                  play" line on past days. */}
              {myEntry && !(isToday && editingScore) ? (
                <EntryRow
                  entry={myEntry}
                  game={game}
                  isMe
                  onEdit={
                    isToday
                      ? () => {
                          setDraft(myEntry.scoreRaw ?? "");
                          setEditingScore(true);
                        }
                      : undefined
                  }
                  onClear={
                    isToday
                      ? async () => {
                          const ok = await confirm({
                            title: "Clear your score for today?",
                            message: "Your result is removed. Scores on other days are kept.",
                            confirmLabel: "Clear",
                            destructive: true,
                          });
                          if (ok) clearMutation.mutate();
                        }
                      : undefined
                  }
                />
              ) : isToday && editingScore ? (
                <ScoreComposer
                  draft={draft}
                  baseline={myScore ?? ""}
                  onChangeDraft={setDraft}
                  onSubmit={onSubmitEdit}
                  onCancel={() => {
                    setDraft("");
                    setEditingScore(false);
                  }}
                  pending={upsertMutation.isPending}
                  userName={user?.displayName ?? null}
                  userAvatarUrl={user?.avatarUrl ?? null}
                />
              ) : isToday ? (
                <View style={[styles.entry, styles.entryMe]} testID="game-board-play-cta">
                  <View style={styles.entryHeader}>
                    <Avatar name={user?.displayName ?? null} imageUrl={user?.avatarUrl} size="md" />
                    <View style={styles.entryNameWrap}>
                      <Text variant="label" style={styles.entryName}>
                        {user?.displayName?.trim() || "You"}
                      </Text>
                      <Text variant="caption" tone="muted">
                        You haven't played yet
                      </Text>
                    </View>
                  </View>
                  <View style={styles.playCtaActions}>
                    <Button
                      label="Paste result"
                      variant="secondary"
                      size="md"
                      onPress={() => openPasteFor({ id: gameId, url: game.url })}
                      testID="game-board-paste-open"
                    />
                    <Button
                      label="Play"
                      size="md"
                      onPress={() => markPlaying({ id: gameId, url: game.url })}
                      testID="game-board-play"
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.unplayedRow} testID="game-board-my-unplayed">
                  <Avatar
                    name={user?.displayName ?? null}
                    imageUrl={user?.avatarUrl}
                    size="md"
                    style={styles.unplayedAvatar}
                  />
                  <Text variant="caption" tone="muted">
                    You didn't play this day.
                  </Text>
                </View>
              )}

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

        <GameScorePasteSheet
          item={pasteTarget}
          userName={user?.displayName ?? null}
          userAvatarUrl={user?.avatarUrl ?? null}
          pending={upsertMutation.isPending}
          spec={pasteTarget ? specForGame(pasteTarget) : null}
          // Same gate as home: admins may re-teach a parsing game; everyone
          // gets the teach chips on a game's first paste (no spec yet).
          canReteach={!!user?.isAdmin && pasteTarget != null && isGameReteachable(pasteTarget)}
          onTeach={(_game, scoreRaw, taught) =>
            upsertMutation.mutate({ scoreRaw, isEdit: false, taught })
          }
          onSubmit={(_game, scoreRaw) => upsertMutation.mutate({ scoreRaw, isEdit: false })}
          onClose={dismiss}
        />

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
                accessibilityLabel="Clear your score for today"
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
  draft: string;
  baseline: string;
  onChangeDraft: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  userName: string | null;
  userAvatarUrl?: string | null;
}

// The my-slot in edit mode — fixing a botched paste in place. Pre-fills the
// field and disables Save until the text actually changes. First-time posts
// go through GameScorePasteSheet (Play CTA above), which carries the parse
// preview and teach flow; clearing lives on the row's Edit/Clear pair.
function ScoreComposer({
  draft,
  baseline,
  onChangeDraft,
  onSubmit,
  onCancel,
  pending,
  userName,
  userAvatarUrl,
}: ScoreComposerProps) {
  const trimmed = draft.trim();
  const empty = trimmed.length === 0;
  const unchanged = trimmed === baseline.trim();
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
            Edit your result
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
        autoFocus
        maxLength={2000}
        style={styles.pasteInput}
        {...webProps}
      />
      <View style={styles.pasteActions}>
        <Button
          label="Cancel"
          variant="secondary"
          size="md"
          onPress={onCancel}
          disabled={pending}
          testID="game-board-edit-cancel"
        />
        <Button
          label="Save"
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
  playCtaActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.sm,
  },
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
  unplayedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    paddingHorizontal: tokens.space.xs,
  },
  unplayedAvatar: { opacity: 0.5 },
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
