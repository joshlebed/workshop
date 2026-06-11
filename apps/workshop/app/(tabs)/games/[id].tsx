import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameStandingsEntry } from "@workshop/shared/games";
import { Redirect, useLocalSearchParams } from "expo-router";
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
import { fetchGameLeaderboard, fetchMyGames, upsertGameScore } from "../../../src/api/games";
import { DayRail } from "../../../src/components/DayRail";
import { useAuth } from "../../../src/hooks/useAuth";
import { errorMessage } from "../../../src/lib/api";
import { userAvatarImageUrl } from "../../../src/lib/avatar";
import { GAMES_TAB_ENABLED } from "../../../src/lib/featureFlags";
import { formatGameDateLabel, localDateKey } from "../../../src/lib/gameDate";
import { goBack } from "../../../src/lib/goBack";
import { haptics } from "../../../src/lib/haptics";
import { openExternalUrl } from "../../../src/lib/openUrl";
import { queryKeys } from "../../../src/lib/queryKeys";
import { formatRelative } from "../../../src/lib/relativeTime";
import { summarizeGameScoreBody } from "../../../src/lib/scoresSummary";
import { Avatar, Button, EmptyState, Screen, Text, tokens, useToast } from "../../../src/ui/index";

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
  const { token, user } = useAuth();
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
    enabled: !!token && GAMES_TAB_ENABLED,
  });
  const myGame = myGamesQuery.data?.games.find((g) => g.gameId === gameId);
  const game = myGame?.game ?? null;

  const boardQuery = useQuery({
    queryKey: queryKeys.games.leaderboard(gameId ?? "", date),
    queryFn: () => fetchGameLeaderboard(gameId ?? "", date, token),
    enabled: !!token && !!gameId && GAMES_TAB_ENABLED,
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

  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }

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
            <Button label="Back to Games" variant="secondary" onPress={() => goBack("/games")} />
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
            onPress={() => goBack("/games")}
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
                <EntryRow key={entry.userId} entry={entry} game={game} isMe={false} />
              ))}
            </View>
          )}
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}

interface EntryRowProps {
  entry: GameStandingsEntry;
  game: { title: string; url: string | null };
  isMe: boolean;
  onEdit?: () => void;
}

function EntryRow({ entry, game, isMe, onEdit }: EntryRowProps) {
  const name = entry.displayName ?? "Someone";
  // Same distillation as the home card (and the Lists clipboard recap): a
  // URL-only share formats to nothing → show "Played" rather than the link.
  const body = summarizeGameScoreBody(game, entry);
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
        {onEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit your score"
            onPress={onEdit}
            testID="game-board-edit-score"
            hitSlop={8}
            style={({ pressed }) => [styles.editScoreButton, pressed && styles.editScorePressed]}
          >
            <Text style={styles.editScoreLabel}>Edit</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.scoreFrame}>
        <Text
          style={[styles.scoreText, body ? null : styles.scoreTextMuted]}
          testID={`game-board-score-${entry.userId}`}
        >
          {body ?? "Played"}
        </Text>
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
// until the text actually changes. (No clear-score here: the Games API has no
// score delete in v1 — re-paste to fix.)
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
  // On web, ⌘/Ctrl+Enter posts — a multiline paste form shouldn't require the
  // mouse. Plain Enter inserts a newline (results are multi-line).
  const webProps =
    Platform.OS === "web"
      ? ({
          onKeyDown: (e: {
            key: string;
            metaKey?: boolean;
            ctrlKey?: boolean;
            preventDefault: () => void;
          }) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
              e.preventDefault();
              onSubmit();
            }
          },
        } as Record<string, unknown>)
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
        placeholderTextColor={tokens.text.muted}
        multiline
        autoFocus={isEdit}
        maxLength={2000}
        style={styles.pasteInput}
        {...webProps}
      />
      <View style={styles.pasteActions}>
        {Platform.OS === "web" && canSubmit ? (
          <Text variant="caption" tone="muted" style={styles.pasteHint}>
            ⌘↩ to {isEdit ? "save" : "post"}
          </Text>
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
  editScoreButton: {
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
  scoreFrame: {
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
  pasteHint: { letterSpacing: 0.3, marginRight: "auto" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xl,
  },
});
