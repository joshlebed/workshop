import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GameLeaderboardEntry } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { deleteItemScore, fetchItemScores, upsertItemScore } from "../../../../src/api/gameScores";
import { fetchItem } from "../../../../src/api/items";
import { useAuth } from "../../../../src/hooks/useAuth";
import { errorMessage } from "../../../../src/lib/api";
import { formatGameDateLabel, localDateKey, shiftDateKey } from "../../../../src/lib/gameDate";
import { haptics } from "../../../../src/lib/haptics";
import { queryKeys } from "../../../../src/lib/queryKeys";
import { formatRelative } from "../../../../src/lib/relativeTime";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  IconButton,
  Text,
  tokens,
  useToast,
} from "../../../../src/ui/index";

/**
 * Per-game detail screen for a games list. Combines:
 *   1. Day strip (‹ prev / current label / next ›). Going past today is
 *      disabled so users don't try to enter scores for tomorrow.
 *   2. Open-game button — launches the game URL externally.
 *   3. Paste-score box (only when viewing today). Pasted scores upload to
 *      today's bucket per spec, regardless of which day the leaderboard is
 *      showing — the date used is the user's local YYYY-MM-DD.
 *   4. Leaderboard — every list member with their pasted score, or a
 *      "Hasn't played" placeholder when null.
 */
export default function GameDetail() {
  const params = useLocalSearchParams<{ id: string; itemId: string }>();
  const listId = Array.isArray(params.id) ? params.id[0] : params.id;
  const itemId = Array.isArray(params.itemId) ? params.itemId[0] : params.itemId;
  const router = useRouter();
  const { token, user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const today = localDateKey();
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState("");

  const itemQuery = useQuery({
    queryKey: queryKeys.items.detail(itemId ?? ""),
    queryFn: () => fetchItem(itemId ?? "", token),
    enabled: !!token && !!itemId,
  });

  const scoresQuery = useQuery({
    queryKey: queryKeys.gameScores.forItem(itemId ?? "", date),
    queryFn: () => fetchItemScores(itemId ?? "", date, token),
    enabled: !!token && !!itemId,
  });

  const myEntry: GameLeaderboardEntry | undefined = scoresQuery.data?.entries.find(
    (e) => e.userId === user?.id,
  );

  const upsertMutation = useMutation({
    mutationFn: (score: string) => {
      if (!itemId) throw new Error("missing item id");
      // Spec: paste always uploads to today's bucket in the user's locale.
      return upsertItemScore(itemId, { date: today, score }, token);
    },
    onSuccess: async () => {
      haptics.medium();
      setDraft("");
      // Invalidate today's scores plus the list-wide aggregate for today.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forItem(itemId ?? "", today),
        }),
        listId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.gameScores.forList(listId, today),
            })
          : Promise.resolve(),
      ]);
      showToast({ message: "Score posted", tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't save score"), tone: "danger" });
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => {
      if (!itemId) throw new Error("missing item id");
      return deleteItemScore(itemId, today, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.gameScores.forItem(itemId ?? "", today),
        }),
        listId
          ? queryClient.invalidateQueries({
              queryKey: queryKeys.gameScores.forList(listId, today),
            })
          : Promise.resolve(),
      ]);
      showToast({ message: "Score cleared", tone: "default" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't clear score"), tone: "danger" });
    },
  });

  if (!itemId || !listId) {
    return (
      <View style={styles.center}>
        <EmptyState title="Missing ids" />
      </View>
    );
  }

  if (itemQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (itemQuery.isError || !itemQuery.data) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Couldn't load game"
          description={errorMessage(itemQuery.error)}
          action={<Button label="Retry" variant="secondary" onPress={() => itemQuery.refetch()} />}
        />
      </View>
    );
  }

  const item = itemQuery.data.item;
  const meta = item.metadata as { thumbnailUrl?: string; siteName?: string };
  const thumb = typeof meta.thumbnailUrl === "string" ? meta.thumbnailUrl : null;
  const isToday = date === today;

  // Clear the textbox alongside date changes — pasting always lands in today,
  // but the box only renders on today, so leftover text from a previous-day
  // navigation would be confusing.
  const onPrevDay = () => {
    setDate(shiftDateKey(date, -1));
    setDraft("");
  };
  const onNextDay = () => {
    if (isToday) return;
    setDate(shiftDateKey(date, 1));
    setDraft("");
  };

  const onOpenGame = () => {
    if (!item.url) {
      showToast({ message: "No URL set on this game.", tone: "danger" });
      return;
    }
    Linking.openURL(item.url).catch(() => {
      showToast({ message: "Couldn't open the game URL.", tone: "danger" });
    });
  };

  const onPasteFromClipboard = async () => {
    // Web only — native clipboard read needs expo-clipboard which the repo
    // hasn't added yet (see lib/share.ts:30 for the same caveat). Native
    // users still paste via the OS keyboard / long-press into the textbox.
    if (Platform.OS !== "web" || typeof navigator === "undefined") return;
    const clip = navigator.clipboard;
    if (!clip || typeof clip.readText !== "function") {
      showToast({ message: "Clipboard isn't accessible in this browser.", tone: "danger" });
      return;
    }
    try {
      const text = await clip.readText();
      if (!text) {
        showToast({ message: "Clipboard is empty.", tone: "default" });
        return;
      }
      setDraft(text);
    } catch {
      showToast({
        message: "Browser blocked clipboard access — paste manually instead.",
        tone: "danger",
      });
    }
  };

  const onSubmit = () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    upsertMutation.mutate(trimmed);
  };

  const onClear = () => {
    Alert.alert("Clear today's score?", "This removes your pasted score for today only.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => clearMutation.mutate() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <IconButton accessibilityLabel="Back" onPress={() => router.back()}>
          <Text style={styles.headerGlyph}>‹</Text>
        </IconButton>
        <Text variant="heading" numberOfLines={1} style={styles.headerTitle}>
          {item.title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Card elevated style={styles.gameCard}>
          {thumb ? (
            <Image
              source={{ uri: thumb }}
              style={styles.gameThumb}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[styles.gameThumb, styles.gameThumbPlaceholder]}>
              <Text style={styles.gameThumbGlyph}>🎮</Text>
            </View>
          )}
          <View style={styles.gameMeta}>
            {meta.siteName ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {meta.siteName}
              </Text>
            ) : null}
            {item.url ? (
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {item.url}
              </Text>
            ) : null}
          </View>
          <Button
            label="Open game ↗"
            variant="secondary"
            onPress={onOpenGame}
            disabled={!item.url}
            testID="game-detail-open"
          />
        </Card>

        <View style={styles.dateStrip}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            onPress={onPrevDay}
            hitSlop={10}
            style={({ pressed }) => [styles.dateNav, pressed && styles.dateNavPressed]}
            testID="game-detail-prev-day"
          >
            <Text style={styles.dateNavGlyph}>‹</Text>
          </Pressable>
          <View style={styles.dateLabelWrap}>
            <Text variant="label" style={styles.dateLabel} testID="game-detail-date-label">
              {formatGameDateLabel(date, today)}
            </Text>
            <Text variant="caption" tone="muted">
              {date}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next day"
            onPress={onNextDay}
            disabled={isToday}
            hitSlop={10}
            style={({ pressed }) => [
              styles.dateNav,
              pressed && styles.dateNavPressed,
              isToday && styles.dateNavDisabled,
            ]}
            testID="game-detail-next-day"
          >
            <Text style={[styles.dateNavGlyph, isToday && styles.dateNavGlyphDisabled]}>›</Text>
          </Pressable>
        </View>

        {isToday ? (
          <Card elevated style={styles.pasteCard}>
            <Text variant="label" tone="secondary" style={styles.pasteLabel}>
              {myEntry?.score ? "Update today's score" : "Paste your score"}
            </Text>
            <TextInput
              testID="game-detail-paste-input"
              value={draft}
              onChangeText={setDraft}
              placeholder={"Long-press to paste — e.g.\n#globle\n9 | Avg. Guesses: 7.1\n= 3"}
              placeholderTextColor={tokens.text.muted}
              multiline
              maxLength={2000}
              style={styles.pasteInput}
            />
            <View style={styles.pasteActions}>
              {Platform.OS === "web" ? (
                <Button
                  label="Paste from clipboard"
                  variant="secondary"
                  size="md"
                  onPress={onPasteFromClipboard}
                  testID="game-detail-paste-clipboard"
                />
              ) : null}
              <Button
                label="Post score"
                size="md"
                onPress={onSubmit}
                disabled={draft.trim().length === 0 || upsertMutation.isPending}
                loading={upsertMutation.isPending}
                testID="game-detail-paste-submit"
              />
            </View>
            {myEntry?.score ? (
              <Pressable
                accessibilityRole="button"
                onPress={onClear}
                disabled={clearMutation.isPending}
                style={({ pressed }) => [styles.clearLink, pressed && styles.clearLinkPressed]}
                testID="game-detail-clear-score"
              >
                <Text tone="muted" variant="caption">
                  Clear my score
                </Text>
              </Pressable>
            ) : null}
          </Card>
        ) : null}

        <View style={styles.leaderboardWrap}>
          <Text variant="label" tone="secondary" style={styles.leaderboardLabel}>
            Leaderboard
          </Text>
          {scoresQuery.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={tokens.accent.default} />
            </View>
          ) : scoresQuery.isError ? (
            <Text tone="danger" style={styles.helper}>
              Couldn't load scores.
            </Text>
          ) : (scoresQuery.data?.entries ?? []).length === 0 ? (
            <Text tone="muted" style={styles.helper}>
              No members on this list.
            </Text>
          ) : (
            (scoresQuery.data?.entries ?? []).map((entry) => (
              <LeaderboardRow key={entry.userId} entry={entry} isMe={entry.userId === user?.id} />
            ))
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface LeaderboardRowProps {
  entry: GameLeaderboardEntry;
  isMe: boolean;
}

function LeaderboardRow({ entry, isMe }: LeaderboardRowProps) {
  const hasScore = entry.score != null && entry.score.length > 0;
  const name = entry.displayName ?? "Someone";
  return (
    <View style={styles.entryRow} testID={`leaderboard-row-${entry.userId}`}>
      <View style={styles.entryHeader}>
        <Avatar name={entry.displayName} size="sm" />
        <View style={styles.entryNameWrap}>
          <Text variant="body" style={styles.entryName}>
            {name}
            {isMe ? "  (you)" : ""}
          </Text>
          {hasScore && entry.updatedAt ? (
            <Text variant="caption" tone="muted">
              posted {formatRelative(entry.updatedAt)}
            </Text>
          ) : null}
        </View>
      </View>
      {hasScore ? (
        <Text style={styles.entryScore} testID={`leaderboard-score-${entry.userId}`}>
          {entry.score}
        </Text>
      ) : (
        <Text tone="muted" variant="caption" style={styles.entryEmpty}>
          Hasn't played yet
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.md,
    gap: tokens.space.sm,
  },
  headerTitle: { flex: 1, letterSpacing: -0.4 },
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.xl },
  headerSpacer: { width: 40 },
  body: {
    paddingHorizontal: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  gameCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  gameThumb: {
    width: 56,
    height: 56,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  gameThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  gameThumbGlyph: { fontSize: 26 },
  gameMeta: { flex: 1, minWidth: 0, gap: 2 },
  dateStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: tokens.space.xs,
  },
  dateNav: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.surface,
  },
  dateNavPressed: { backgroundColor: tokens.bg.elevated },
  dateNavDisabled: { opacity: 0.4 },
  dateNavGlyph: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.xl,
    lineHeight: tokens.font.size.xl + 4,
  },
  dateNavGlyphDisabled: { color: tokens.text.muted },
  dateLabelWrap: { alignItems: "center", gap: 2 },
  dateLabel: { fontSize: tokens.font.size.lg, letterSpacing: -0.2 },
  pasteCard: { gap: tokens.space.md },
  pasteLabel: { letterSpacing: 0.5, textTransform: "uppercase" },
  pasteInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  pasteActions: {
    flexDirection: "row",
    gap: tokens.space.sm,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  clearLink: { alignSelf: "center", paddingVertical: tokens.space.xs },
  clearLinkPressed: { opacity: 0.6 },
  leaderboardWrap: { gap: tokens.space.sm },
  leaderboardLabel: { letterSpacing: 0.5, textTransform: "uppercase" },
  helper: { paddingVertical: tokens.space.lg, textAlign: "center" },
  entryRow: {
    paddingVertical: tokens.space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.border.subtle,
    gap: tokens.space.sm,
  },
  entryHeader: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  entryNameWrap: { flex: 1, minWidth: 0, gap: 1 },
  entryName: { fontWeight: tokens.font.weight.semibold },
  entryScore: {
    color: tokens.text.primary,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: tokens.font.size.sm,
    lineHeight: tokens.font.size.sm + 4,
    paddingLeft: 32,
  },
  entryEmpty: { paddingLeft: 32 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: tokens.space.xl,
  },
});
