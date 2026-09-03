// One game's board — the full column behind a home band.
//
// The screen is pushed as a cross-fade, and its header starts life at the exact
// window position the tapped band occupied, then steps up into place. The band
// appears to unfold into the screen rather than a new card sliding in from the
// right. There is no back chevron: BACK is a dock key, the iOS edge gesture
// still works, and dragging the header down dismisses. Opening the game itself
// is the dock's PLAY key — there is no second "open" affordance in the header.
//
// Product rules are unchanged from the original board: scores always post to
// *today's* bucket regardless of which day is being read, and the rail never
// offers a future day.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, GameLeaderboardResponse, GameStandingsEntry } from "@workshop/shared/games";
import { STREAK_MIN_DAYS } from "@workshop/shared/games";
import { confirm, haptics, openExternalUrl } from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DOCK_HEIGHT, type DockKey, useDock } from "../../nav/dock";
import { takeRow } from "../../nav/rowGeometry";
import { Avatar } from "../../theme/Avatar";
import { Button } from "../../theme/Button";
import { EmptyState } from "../../theme/EmptyState";
import { Screen } from "../../theme/layout";
import { PixelIcon } from "../../theme/PixelIcon";
import { Text } from "../../theme/Text";
import { useToast } from "../../theme/Toast";
import { stepped, tokens } from "../../theme/tokens";
import {
  clearGameScore,
  fetchGameLeaderboard,
  fetchMyGames,
  removeGame,
  upsertGameScore,
} from "../api/games";
import { DayScrubber } from "../components/DayScrubber";
import { ReactionPickerSheet } from "../components/ReactionPickerSheet";
import { ScoreReactions } from "../components/ScoreReactions";
import { useScoreReactions } from "../hooks/useScoreReactions";
import { formatGameDateLabel, localDateKey } from "../lib/gameDate";
import { goBack } from "../lib/navigation";
import { summarizeGameScoreBody } from "../lib/scoresSummary";
import { useGamesRuntime } from "../runtime";

/** Header block top inset inside the screen; the unfold measures against it. */
const HEADER_TOP = tokens.space.sm;
/** Drag the header down past this to dismiss. */
const DISMISS_AT = 96;
const RAIL = 42;

export default function GameBoard() {
  const params = useLocalSearchParams<{ id: string }>();
  const gameId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, user, routes } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();

  const today = localDateKey();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState("");
  const [editingScore, setEditingScore] = useState(false);

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
      showToast({ message: variables.isEdit ? "Score updated" : "Score posted", tone: "success" });
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

  // ── The unfold ───────────────────────────────────────────────────────────
  // The band's window position at tap time, translated into how far the header
  // has to travel. `takeRow` consumes the hand-off, so a back-then-forward or a
  // cold deep link gets a plain fade instead of a header flying in from a
  // remembered position that no longer means anything.
  const startOffset = useMemo(() => {
    const rect = gameId ? takeRow(gameId) : null;
    if (!rect) return 0;
    return Math.max(0, Math.min(560, rect.pageY - (insets.top + HEADER_TOP)));
  }, [gameId, insets.top]);

  const unfold = useSharedValue(startOffset === 0 ? 1 : 0);
  useEffect(() => {
    unfold.value = withTiming(1, { duration: tokens.motion.base, easing: stepped });
  }, [unfold]);

  const dismiss = useSharedValue(0);
  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - unfold.value) * startOffset + dismiss.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: unfold.value,
    transform: [{ translateY: (1 - unfold.value) * 12 + dismiss.value }],
  }));

  const back = useCallback(() => goBack(routes.home), [routes.home]);

  const removeMutation = useMutation({
    mutationFn: () => {
      if (!gameId) throw new Error("missing game id");
      return removeGame(gameId, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: queryKeys.games.mine(today) });
      back();
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't remove that game."), tone: "danger" });
    },
  });

  const onRemove = useCallback(async () => {
    if (!game) return;
    const ok = await confirm({
      title: `Remove ${game.title} from your board?`,
      message: "Your past scores stay — re-adding the game brings them back.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) removeMutation.mutate();
  }, [game, removeMutation]);
  const headerPan = Gesture.Pan()
    .activeOffsetY(16)
    .failOffsetY(-10)
    .onUpdate((e) => {
      dismiss.value = Math.max(0, e.translationY);
    })
    .onEnd(() => {
      if (dismiss.value >= DISMISS_AT) runOnJS(back)();
      dismiss.value = withTiming(0, { duration: tokens.motion.base, easing: stepped });
    });

  const streak = myGame?.standings.viewerStreak ?? 0;
  const isToday = date === today;
  const entries = boardQuery.data?.entries ?? [];
  const myEntry = entries.find((e) => e.userId === user?.id);
  const myScore = myEntry?.scoreRaw && myEntry.scoreRaw.length > 0 ? myEntry.scoreRaw : null;
  const showComposer = isToday && (!myScore || editingScore);

  // ── Dock ─────────────────────────────────────────────────────────────────
  const dockKeys = useMemo<DockKey[]>(() => {
    const keys: DockKey[] = [
      {
        id: "play",
        label: "Play",
        glyph: "play",
        tone: "primary",
        weight: 1.5,
        disabled: !game,
        onPress: () => {
          if (game) openExternalUrl(game.url);
        },
        testID: "dock-play",
        accessibilityLabel: game ? `Play ${game.title}` : "Play",
      },
    ];
    if (isToday) {
      keys.push({
        id: "paste",
        label: myScore ? "Edit" : "Paste",
        glyph: myScore ? "pencil" : "clipboard",
        weight: 1.2,
        onPress: () => {
          setDraft(myScore ?? "");
          setEditingScore(true);
        },
        testID: "dock-paste",
      });
    } else {
      keys.push({
        id: "paste",
        label: "Today",
        glyph: "reload",
        weight: 1.2,
        onPress: () => setDate(today),
        testID: "dock-today",
      });
    }
    keys.push(
      {
        id: "remove",
        label: "Remove",
        glyph: "trash",
        weight: 0.9,
        disabled: !game,
        onPress: () => void onRemove(),
        testID: "game-board-remove",
        accessibilityLabel: game ? `Remove ${game.title} from your board` : "Remove",
      },
      {
        id: "back",
        label: "Back",
        glyph: "arrow-left",
        weight: 0.7,
        onPress: back,
        testID: "game-board-back",
      },
    );
    return keys;
  }, [game, isToday, myScore, today, back, onRemove]);
  useDock(dockKeys);

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
        <ActivityIndicator color={tokens.neon.pink} />
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
          title="Not on your board"
          description="This game isn't on your board."
          action={<Button label="Back" variant="secondary" onPress={back} />}
        />
      </Screen>
    );
  }

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
        {/* The header is the band, continued: same 42px rail, same mark, same
            title position — only the type size grows. */}
        <GestureDetector gesture={headerPan}>
          <Animated.View style={[styles.header, headerStyle]}>
            <View style={styles.rail}>
              {game.iconUrl ? (
                <Image
                  source={{ uri: game.iconUrl }}
                  style={styles.mark}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={[styles.mark, styles.markPlaceholder]}>
                  <PixelIcon name="gamepad" size={16} color={tokens.text.secondary} />
                </View>
              )}
            </View>
            <View style={styles.headerText}>
              <Text variant="title" numberOfLines={2} style={styles.title}>
                {game.title}
              </Text>
              <View style={styles.headerMeta}>
                {host ? (
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {host}
                  </Text>
                ) : null}
                {streak >= STREAK_MIN_DAYS ? (
                  <Text variant="caption" tone="success">
                    {`${streak}-day run`}
                  </Text>
                ) : null}
              </View>
            </View>
          </Animated.View>
        </GestureDetector>

        <Animated.View style={[styles.contentWrap, contentStyle]}>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <DayScrubber
              selectedDate={date}
              today={today}
              onSelectDate={onDate}
              testIDPrefix="game-board-day"
            />

            <View style={styles.dayHeader}>
              <Text variant="heading" tone="secondary" style={styles.dayTitle}>
                {formatGameDateLabel(date, today)}
              </Text>
              {boardQuery.isPending ? null : (
                <Text variant="heading" tone="secondary" style={styles.dayCount}>
                  {entries.length === 0 ? "none" : `${entries.length} played`}
                </Text>
              )}
            </View>

            {boardQuery.isPending ? (
              <View style={styles.center}>
                <ActivityIndicator color={tokens.neon.pink} />
              </View>
            ) : boardQuery.isError ? (
              <View style={styles.errorBlock}>
                <Text tone="danger">Couldn't load scores.</Text>
                <Button
                  label="Try again"
                  variant="secondary"
                  onPress={() => boardQuery.refetch()}
                  loading={boardQuery.isFetching}
                  testID="game-board-scores-retry"
                />
              </View>
            ) : (
              <View style={styles.leaderboard}>
                {showComposer ? (
                  <ScoreComposer
                    mode={myScore ? "edit" : "new"}
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
                ) : !myEntry ? (
                  <View style={styles.unplayed} testID="game-board-my-unplayed">
                    <Avatar
                      name={user?.displayName ?? null}
                      imageUrl={user?.avatarUrl}
                      size="sm"
                      style={styles.unplayedAvatar}
                    />
                    <Text variant="caption" tone="secondary">
                      you didn’t play this day
                    </Text>
                  </View>
                ) : null}

                {entries.map((entry) => {
                  const isMe = entry.userId === user?.id;
                  if (isMe && showComposer) return null;
                  return (
                    <EntryRow
                      key={entry.userId}
                      entry={entry}
                      game={game}
                      isMe={isMe}
                      {...(isMe && isToday
                        ? {
                            onClear: async () => {
                              const ok = await confirm({
                                title: "Clear your score for today?",
                                message: "Your result is removed. Scores on other days are kept.",
                                confirmLabel: "Clear",
                                destructive: true,
                              });
                              if (ok) clearMutation.mutate();
                            },
                          }
                        : {})}
                      {...(isMe
                        ? {}
                        : {
                            onReact: (userId: string, emoji: string, currentlyReacted: boolean) =>
                              reactionCtl.react(gameId, userId, emoji, currentlyReacted),
                            onOpenReactionPicker: (userId: string) =>
                              reactionCtl.openPicker(gameId, userId, entry.displayName ?? null),
                          })}
                    />
                  );
                })}
              </View>
            )}
          </ScrollView>
        </Animated.View>

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
  onClear?: () => void;
  onReact?: (userId: string, emoji: string, currentlyReacted: boolean) => void;
  onOpenReactionPicker?: (userId: string) => void;
}

function EntryRow({ entry, game, isMe, onClear, onReact, onOpenReactionPicker }: EntryRowProps) {
  const [expanded, setExpanded] = useState(false);
  const name = entry.displayName?.trim() || "Someone";
  const body = summarizeGameScoreBody(game, entry);
  const canReact = !isMe && !!onOpenReactionPicker;
  const showReactions = entry.reactions.length > 0 || canReact;
  const hero = entry.scoreValue != null ? String(entry.scoreValue) : null;
  const multiline = (body?.split("\n").length ?? 0) > 1;
  return (
    <View style={[styles.entry, isMe && styles.entryMe]} testID={`game-board-row-${entry.userId}`}>
      <View style={styles.entryRank}>
        <Text
          variant="score"
          tone={entry.rank === 1 ? "spotlight" : "secondary"}
          style={styles.rankText}
        >
          {entry.rank != null ? String(entry.rank) : "·"}
        </Text>
      </View>
      <View style={styles.entryBody}>
        <View style={styles.entryTop}>
          <Avatar name={entry.displayName} imageUrl={userAvatarImageUrl(entry.userId)} size="sm" />
          <Text variant="label" numberOfLines={1} style={styles.entryName}>
            {isMe ? "You" : name}
          </Text>
          {onClear ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear your score for today"
              onPress={onClear}
              testID="game-board-clear-score"
              hitSlop={8}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.clearKey,
                (pressed || hovered) && styles.clearKeyActive,
              ]}
            >
              <Text variant="heading" tone="danger" style={styles.clearLabel}>
                Clear
              </Text>
            </Pressable>
          ) : null}
        </View>
        {hero ? (
          <Text
            variant="score"
            style={styles.entryHero}
            testID={`game-board-score-${entry.userId}`}
          >
            {hero}
          </Text>
        ) : null}
        {/* Your own share stays open — it's the one row on the page that is
            about you. Everyone else's collapses to a single line with a real
            expand key, so four Wordle grids don't eat the screen. */}
        {body ? (
          multiline && !isMe ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                expanded ? `Collapse ${name}'s result` : `Expand ${name}'s result`
              }
              onPress={() => setExpanded((v) => !v)}
              testID={`game-board-expand-${entry.userId}`}
              style={styles.rawRow}
            >
              <Text
                variant="data"
                tone="secondary"
                style={styles.entryRaw}
                numberOfLines={expanded ? undefined : 1}
                testID={hero ? undefined : `game-board-score-${entry.userId}`}
              >
                {body}
              </Text>
              <PixelIcon
                name={expanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={tokens.text.secondary}
              />
            </Pressable>
          ) : (
            <Text
              variant="data"
              tone="secondary"
              style={styles.entryRaw}
              testID={hero ? undefined : `game-board-score-${entry.userId}`}
            >
              {body}
            </Text>
          )
        ) : hero ? null : (
          <Text variant="data" tone="secondary" style={styles.entryRawMuted}>
            NO ENTRY
          </Text>
        )}
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
  const canSubmit = trimmed.length > 0 && !(isEdit && trimmed === baseline.trim()) && !pending;
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
      <View style={styles.entryRank}>
        <Avatar name={userName} imageUrl={userAvatarUrl} size="sm" />
      </View>
      <View style={styles.entryBody}>
        <Text variant="heading" tone="secondary" style={styles.composerLabel}>
          {isEdit ? "Fix your result" : "Paste your result"}
        </Text>
        <TextInput
          testID="game-board-paste-input"
          value={draft}
          onChangeText={onChangeDraft}
          placeholder="Paste your result here"
          placeholderTextColor={tokens.text.secondary}
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
              variant="ghost"
              onPress={onCancel}
              disabled={pending}
              testID="game-board-edit-cancel"
            />
          ) : null}
          <Button
            label={isEdit ? "Save" : "Post"}
            onPress={onSubmit}
            disabled={!canSubmit}
            loading={pending}
            testID="game-board-paste-submit"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: HEADER_TOP,
    paddingBottom: tokens.space.md,
    paddingRight: tokens.space.md,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  rail: {
    width: RAIL,
    alignItems: "center",
    alignSelf: "stretch",
    paddingTop: tokens.space.xs,
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  mark: {
    width: 24,
    height: 24,
    backgroundColor: tokens.bg.raised,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  markPlaceholder: { alignItems: "center", justifyContent: "center" },
  headerText: { flex: 1, minWidth: 0, paddingLeft: tokens.space.md, gap: tokens.space.xs },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  title: { fontSize: 14, lineHeight: 22, color: tokens.text.primary },
  contentWrap: { flex: 1 },
  body: { paddingBottom: DOCK_HEIGHT + tokens.space.xl },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.md,
    paddingBottom: tokens.space.sm,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  dayTitle: { fontSize: 10 },
  dayCount: { fontSize: 10 },
  errorBlock: { gap: tokens.space.md, padding: tokens.space.lg, alignItems: "flex-start" },
  leaderboard: {},
  entry: {
    flexDirection: "row",
    paddingRight: tokens.space.md,
    paddingVertical: tokens.space.md,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  entryMe: { backgroundColor: tokens.bg.surface },
  entryRank: {
    width: RAIL,
    alignItems: "center",
    alignSelf: "stretch",
    paddingTop: tokens.space.xs,
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  rankText: { fontSize: 12 },
  entryBody: { flex: 1, minWidth: 0, paddingLeft: tokens.space.md, gap: tokens.space.sm },
  entryTop: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  entryName: { flexShrink: 1, color: tokens.text.primary },
  clearKey: {
    marginLeft: "auto",
    height: 30,
    paddingHorizontal: tokens.space.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
  },
  clearKeyActive: { backgroundColor: tokens.bg.raised },
  clearLabel: { fontSize: 10 },
  entryHero: { fontSize: 20, lineHeight: 26, color: tokens.text.primary },
  rawRow: { flexDirection: "row", alignItems: "flex-start", gap: tokens.space.sm },
  entryRaw: { flex: 1, minWidth: 0 },
  entryRawMuted: { letterSpacing: 1 },
  unplayed: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.lg,
    borderBottomWidth: tokens.bezel,
    borderBottomColor: tokens.border.default,
  },
  unplayedAvatar: { opacity: 0.5 },
  composerLabel: { fontSize: 10 },
  pasteInput: {
    minHeight: 96,
    borderWidth: tokens.bezel,
    borderColor: tokens.border.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: 13,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 19,
  },
  pasteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: tokens.space.md,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.lg },
});
