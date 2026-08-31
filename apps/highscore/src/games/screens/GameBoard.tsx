import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, GameLeaderboardResponse, GameStandingsEntry } from "@workshop/shared/games";
import {
  Avatar,
  confirm,
  EmptyState,
  formatRelative,
  haptics,
  openExternalUrl,
  Screen,
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
import { Button, bezel, colors, font, glow, PixelIcon, radius, space, Text } from "../../theme";
import { clearGameScore, fetchGameLeaderboard, fetchMyGames, upsertGameScore } from "../api/games";
import { DayRail } from "../components/DayRail";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { ScoreReactions } from "../components/ScoreReactions";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { formatGameDateLabel, localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";

/**
 * Per-game board (G1b) — history for one game in My Games. The home card
 * owns today's standings; this screen is for paging back through past days
 * (DayRail) plus a paste slot so today is still postable from here.
 *
 * Spec rules (mirrors the Lists game-detail screen):
 *   - Pasted scores always upload to *today's* bucket regardless of which
 *     day the board is showing.
 *   - Going past today on the day rail isn't offered.
 */
export default function GameBoard() {
  const params = useLocalSearchParams<{ id: string }>();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, user, routes } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  const [date, setDate] = useState(today);
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
    mutationFn: ({ scoreRaw }: { scoreRaw: string; isEdit: boolean }) => {
      if (!gameId) throw new Error("missing game id");
      return upsertGameScore(gameId, { periodKey: today, scoreRaw }, token);
    },
    onSuccess: async (_data, variables) => {
      haptics.medium();
      setDraft("");
      setEditingScore(false);
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
        <ActivityIndicator color={colors.primary} />
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
  // existing one. Both only make sense on today (scores always upload to
  // today's bucket), so past days fall through to the read-only row.
  const showComposer = isToday && (!myScore || editingScore);
  const composerMode: "new" | "edit" = myScore ? "edit" : "new";
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
    upsertMutation.mutate({ scoreRaw: trimmed, isEdit: editingScore });
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
            <PixelIcon name="arrowLeft" size={24} color={colors.textPrimary} />
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
              <PixelIcon name="externalLink" size={16} color={colors.textSecondary} />
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
              <ActivityIndicator color={colors.primary} />
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
              {/* My slot is always at the top: the paste composer on today,
                  my filled entry, or a quiet "didn't play" line on past days. */}
              {showComposer ? (
                <ScoreComposer
                  mode={composerMode}
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
  mode: "new" | "edit";
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
            {isEdit ? "Edit your result" : "Paste your result to play"}
          </Text>
        </View>
      </View>
      <TextInput
        testID="game-board-paste-input"
        value={draft}
        onChangeText={onChangeDraft}
        placeholder={"Paste your result here"}
        placeholderTextColor={colors.textSecondary}
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
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: space.xl },
  headerNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.soft,
  },
  navButtonPressed: { backgroundColor: colors.surface2 },
  body: {
    paddingBottom: space.xxl * 2,
    gap: space.lg,
  },
  titleBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    marginHorizontal: space.sm,
    borderRadius: radius.soft,
  },
  titleBlockPressed: { backgroundColor: colors.surface1 },
  titleBadge: {
    width: 56,
    height: 56,
    borderRadius: radius.soft,
    backgroundColor: colors.surface2,
  },
  titleBadgePlaceholder: { alignItems: "center", justifyContent: "center" },
  titleBadgeGlyph: { fontSize: 28, lineHeight: 32 },
  titleText: { flex: 1, minWidth: 0, gap: 4 },
  titleName: { fontSize: 16, lineHeight: 26 },
  titleOpenAffordance: {
    width: 32,
    height: 32,
    borderRadius: radius.soft,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface1,
  },
  dayHeader: {
    paddingHorizontal: space.xl,
    gap: 2,
  },
  dayTitle: { fontSize: 12, lineHeight: 20 },
  helper: {
    paddingVertical: space.lg,
    textAlign: "center",
    paddingHorizontal: space.xl,
  },
  scoresErrorBlock: {
    gap: space.sm,
    paddingBottom: space.md,
  },
  scoresErrorAction: { alignItems: "center" },
  leaderboard: {
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  entry: {
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.soft,
    borderWidth: bezel,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  entryMe: {
    // Pink marks the viewer's own row (v3 Scoreboard); the "you" pill doubles
    // as a textual label so the highlight isn't color-only.
    borderColor: `${colors.primary}66`,
    backgroundColor: `${colors.primary}0F`,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  entryNameWrap: { flex: 1, minWidth: 0, gap: 2 },
  entryNameRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  entryName: { fontSize: font.size.md, color: colors.textPrimary },
  scoreActions: { flexDirection: "row", alignItems: "center", gap: space.xs },
  scoreActionButton: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.soft,
  },
  editScorePressed: { backgroundColor: `${colors.primary}26` },
  editScoreLabel: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.primary,
  },
  // Clear is the quieter, destructive sibling of Edit: neutral text, neutral
  // press tint. The confirm dialog (and "Clear" wording) carry the weight, so
  // the control itself stays calm rather than a loud red on a daily screen.
  clearScorePressed: { backgroundColor: colors.surface2 },
  clearScoreLabel: {
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
    color: colors.textSecondary,
  },
  youPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.soft,
    backgroundColor: `${colors.primary}26`,
  },
  youPillText: {
    fontSize: 10,
    fontWeight: font.weight.semibold,
    letterSpacing: 0.5,
    color: colors.primary,
    textTransform: "uppercase",
  },
  // Score box + reactions share one row so reactions sit to the right of the
  // score instead of below it (no extra row height).
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  scoreFrame: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.soft,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rankBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: radius.soft,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // The #1 rank is the spotlight: neon yellow, accent glow (DESIGN.md).
  rankBadgeTop1: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    ...glow(colors.accentGlow, 8),
  },
  rankBadgeText: {
    fontFamily: font.pixel,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    color: colors.textSecondary,
  },
  rankBadgeTextTop1: { color: colors.textOnNeon },
  // Score numerals in Press Start 2P — effectively monospace, so multi-line
  // result grids keep their column alignment.
  scoreText: {
    color: colors.textPrimary,
    fontFamily: font.pixel,
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 18,
  },
  scoreTextMuted: {
    color: colors.textSecondary,
  },
  unplayedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
  },
  unplayedAvatar: { opacity: 0.5 },
  pasteInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.soft,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: colors.textPrimary,
    fontSize: font.size.sm,
    backgroundColor: colors.bg,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: font.size.sm + 6,
  },
  pasteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: space.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.xl,
  },
});
