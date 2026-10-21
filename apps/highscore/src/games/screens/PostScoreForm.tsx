// The contextless "post a score" form: a paste box, the classifier's
// detected-game card with a one-tap Post, and My Games rows as the manual
// fallback. Two hosts render it — the iOS share route (`PickGame`, full
// screen) and the home's "Paste a score" sheet (`PostScoreSheet`). The form
// owns the draft, detection and the post mutation; hosts decide what happens
// after a post lands (`onPosted`) and where "a different game" goes.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { GameScoreEntrySource } from "@workshop/shared/constants";
import type { Game, MyGame } from "@workshop/shared/games";
import { Button, EmptyState, haptics, Text, tokens, useToast } from "@workshop/ui";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { addGame, fetchMyGames, upsertGameScore } from "../api/games";
import { ScoreCheckPanel } from "../components/ScoreCheckPanel";
import { askScoreDirection } from "../lib/askScoreDirection";
import { localDateKey } from "../lib/gameDate";
import { recognizedGameLabel, recognizedGameTarget } from "../lib/recognition";
import {
  detectSharedScore,
  isResultlessShare,
  pickSuggestedGameTarget,
  type ShareGameTarget,
} from "../lib/shareScoreDetection";
import { teachAfterPost, teachOutcomeMessage } from "../lib/teachAfterPost";
import { useRecognizedGame } from "../lib/useRecognizedGame";
import {
  type ScoreCheck,
  type ScorePostExtras,
  useScoreCheck,
  useTeachAvailable,
} from "../lib/useScoreCheck";
import { useSharePreview } from "../lib/useSharePreview";
import { useGamesRuntime } from "../runtime";

export interface PostedScore {
  gameId: string;
  title: string;
}

export interface PostScoreDetection {
  /** Short game name the classifier / registry detected, or null. */
  label: string | null;
  /** The draft is a game's bare link with no result in it. */
  resultless: boolean;
}

interface PostScoreFormProps {
  /** Pre-filled draft: the share payload, or the clipboard on the home sheet. */
  initialDraft: string;
  /** Provenance recorded on the score write (share extension vs. in-app paste). */
  entrySource: GameScoreEntrySource;
  /** Focus the paste box on mount (home sheet with an empty clipboard). */
  autoFocus?: boolean;
  /** Fires once the score is saved, before the (async) teach step. */
  onPosted: (posted: PostedScore) => void;
  /** "Different game? Add it by link." Hidden when absent. */
  onRequestAddGame?: () => void;
  /** Empty My Games with nothing detected: where "Open Games" goes. */
  onOpenGames?: () => void;
  /** Lets a host echo the detection (PickGame's header pill). */
  onDetectionChange?: (detection: PostScoreDetection) => void;
  style?: StyleProp<ViewStyle>;
}

export function PostScoreForm({
  initialDraft,
  entrySource,
  autoFocus = false,
  onPosted,
  onRequestAddGame,
  onOpenGames,
  onDetectionChange,
  style,
}: PostScoreFormProps) {
  const [scoreDraft, setScoreDraft] = useState(initialDraft);
  const { token } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Detect against the live draft, not the frozen initial payload: the paste
  // box lives on this form, so filling in a result the iOS share sheet dropped
  // should light up the Post button without a trip through another surface.
  const detectedScore = useMemo(() => detectSharedScore(scoreDraft), [scoreDraft]);
  // A game share whose grid was dropped at the share-sheet boundary arrives as
  // just the game's referral URL (e.g. `dailytens.com/?ref=<id>`). It still
  // matches the game's text pattern, so `detectedScore` is non-null, but there
  // is no result to post — one-tap posting would store a bare link.
  const resultlessDraft = isResultlessShare(scoreDraft);
  const today = localDateKey();

  const myGamesQuery = useQuery({
    queryKey: queryKeys.games.mine(today),
    queryFn: () => fetchMyGames(today, token),
    enabled: !!token,
  });
  const myGames = myGamesQuery.data?.games ?? [];

  // Server-side recognition, for accounts that have it: it knows every game
  // with stored scores, including ones the registry has never heard of. Null
  // for everyone else and whenever it has no answer (yet) — the registry
  // detection above stays the behaviour then.
  //
  // Teach v2 accounts ask once for both the game and what posting there would
  // record (`POST /v1/games/score-preview`); recognition is not asked again.
  const teachAvailable = useTeachAvailable();
  const shared = useSharePreview(scoreDraft, today);
  const recognizedAlone = useRecognizedGame(teachAvailable ? "" : scoreDraft);
  const recognized = teachAvailable
    ? shared?.kind === "preview"
      ? shared.match
      : null
    : recognizedAlone;
  const detected = recognized ? { gameLabel: recognizedGameLabel(recognized) } : detectedScore;

  // Where a detected score posts: the matching My Games row when there is one,
  // otherwise the game's URL (find-or-create on post).
  const suggestion = useMemo(
    () =>
      recognized
        ? recognizedGameTarget(recognized)
        : pickSuggestedGameTarget(detectedScore, myGames),
    [recognized, detectedScore, myGames],
  );
  const suggestionLoading = !!detected && !!token && myGamesQuery.isPending && !suggestion;
  // Teach v2: what the one-tap post will record, and the picker when nothing
  // read the score. Checked against the catalog game even when it is not in
  // My Games yet (posting adds it).
  const check = useScoreCheck({
    gameId: recognized?.game.id ?? suggestion?.gameId ?? null,
    text: scoreDraft,
    periodKey: today,
    entry: "share",
    today,
  });
  // The server refused the text (a link or a title with no result in it).
  const serverResultless = shared?.kind === "rejected";

  const detectedLabel = detected?.gameLabel ?? null;
  const resultless = resultlessDraft || serverResultless;
  useEffect(() => {
    onDetectionChange?.({ label: detectedLabel, resultless });
  }, [onDetectionChange, detectedLabel, resultless]);

  const submitScore = useMutation({
    mutationFn: async (target: ShareGameTarget & { extras?: ScorePostExtras }) => {
      const gameId = target.gameId ?? (await addGame(target.url, token)).game.id;
      const result = await upsertGameScore(
        gameId,
        { periodKey: today, scoreRaw: scoreDraft.trim(), entrySource, ...target.extras?.body },
        token,
      );
      return { result, gameId };
    },
    onSuccess: async ({ result, gameId }, target) => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({ message: "Score posted", tone: "success" });
      onPosted({ gameId, title: target.title });
      // A pick that can teach the game does so after the post has landed.
      const taught = await teachAfterPost({
        gameId,
        periodKey: today,
        hint: result.teach,
        scoreDirection: target.extras?.scoreDirection ?? null,
        askDirection: askScoreDirection(target.title),
        token,
      });
      if (taught) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["games"] }),
          queryClient.invalidateQueries({ queryKey: ["game-score-check"] }),
        ]);
      }
      const message = teachOutcomeMessage(taught, target.title);
      if (message) showToast({ message, tone: "success" });
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't post score"), tone: "danger" });
    },
  });

  const postScore = (target: ShareGameTarget & { extras?: ScorePostExtras }) => {
    if (isResultlessShare(scoreDraft) || serverResultless) {
      showToast({
        message: "That's just a link. Paste your result text to post a score.",
        tone: "danger",
      });
      return;
    }
    submitScore.mutate(target);
  };

  const canPost = scoreDraft.trim().length > 0 && !submitScore.isPending;
  const pendingKey = submitScore.isPending ? targetKey(submitScore.variables) : null;
  const rowState = (target: ShareGameTarget) => ({
    disabled: !canPost || (pendingKey !== null && pendingKey !== targetKey(target)),
    loading: pendingKey === targetKey(target),
  });

  return (
    <ScrollView
      style={style}
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {detected ? (
        <DetectedScoreSuggestion
          label={detected.gameLabel}
          suggestion={suggestion}
          loading={suggestionLoading}
          pending={submitScore.isPending}
          resultless={resultless}
          check={check}
          onPost={() => {
            if (!suggestion) return;
            postScore(check.available ? { ...suggestion, extras: check.extras() } : suggestion);
          }}
        />
      ) : null}

      <View style={styles.scoreBox}>
        <View style={styles.scoreHeader}>
          <Text variant="label">Score</Text>
          <Text variant="caption" tone="muted">
            Posts to today
          </Text>
        </View>
        <TextInput
          testID="share-game-score-input"
          value={scoreDraft}
          onChangeText={setScoreDraft}
          placeholder="Paste score text"
          placeholderTextColor={tokens.text.muted}
          multiline
          maxLength={2000}
          autoFocus={autoFocus}
          style={styles.scoreInput}
        />
      </View>

      <View style={styles.gameSectionHeader}>
        <Text variant="heading" style={styles.gameSectionTitle}>
          Your games
        </Text>
        <Text variant="caption" tone="muted">
          {suggestion ? "Or pick a different game." : "Pick the game to update."}
        </Text>
      </View>

      {myGamesQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : myGamesQuery.isError ? (
        <EmptyState
          title="Couldn't load your games"
          description={errorMessage(myGamesQuery.error)}
          action={
            <Button label="Retry" variant="secondary" onPress={() => myGamesQuery.refetch()} />
          }
        />
      ) : myGames.length === 0 ? (
        <EmptyState
          title="No games yet"
          description={
            suggestion
              ? `Post above and we'll add ${suggestion.title} to your games.`
              : onRequestAddGame
                ? "Paste a score and we'll find the game, or add one by link."
                : "Add games on the Games tab, then share a score to post it here."
          }
          action={
            suggestion ? undefined : onRequestAddGame ? (
              <Button label="Add a game by link" variant="secondary" onPress={onRequestAddGame} />
            ) : onOpenGames ? (
              <Button label="Open Games" onPress={onOpenGames} />
            ) : undefined
          }
        />
      ) : (
        <View style={styles.gameList}>
          {myGames.map((mg) => {
            const target = myGameTarget(mg);
            return (
              <GameRow
                key={mg.gameId}
                title={mg.game.title}
                subtitle={shortHost(mg.game.url) ?? "Game"}
                iconUrl={mg.game.iconUrl}
                testID={`share-game-row-${mg.gameId}`}
                {...rowState(target)}
                onPress={() => postScore(target)}
              />
            );
          })}
          {onRequestAddGame ? (
            <Button
              label="Different game? Add it by link"
              variant="ghost"
              onPress={onRequestAddGame}
              disabled={submitScore.isPending}
              testID="share-game-add-by-link"
            />
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

// The one-tap post surface for an auto-detected score. Mirrors the Workshop
// share sheet's affordance: a named destination plus a "Post" button, so the
// common case never requires hunting for a row in the list below.
function DetectedScoreSuggestion({
  label,
  suggestion,
  loading,
  pending,
  resultless,
  check,
  onPost,
}: {
  label: string;
  suggestion: ShareGameTarget | null;
  loading: boolean;
  pending: boolean;
  resultless: boolean;
  /** Teach v2: the dry run of this post and the picker. Renders nothing without it. */
  check: ScoreCheck;
  onPost: () => void;
}) {
  // The share carried the game's link but not the result text. Don't offer
  // one-tap post — the paste field is right below, so ask for the result.
  if (resultless) {
    return (
      <View style={styles.suggestionBox} testID="share-game-detection-resultless">
        <Text variant="label">{label} link detected</Text>
        <Text variant="caption" tone="muted">
          We got the link but not your result. Paste your result below to post a score.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.suggestionBox} testID="share-game-detection-loading">
        <View style={styles.loadingRow}>
          <ActivityIndicator color={tokens.accent.default} size="small" />
          <Text variant="label">{label} score detected</Text>
        </View>
        <Text variant="caption" tone="muted">
          Looking for a matching game.
        </Text>
      </View>
    );
  }

  if (!suggestion) {
    return (
      <View style={styles.suggestionBox} testID="share-game-detection-empty">
        <Text variant="label">{label} score detected</Text>
        <Text variant="caption" tone="muted">
          Pick where to post it below.
        </Text>
      </View>
    );
  }

  const destination = suggestion.gameId
    ? `Post to ${suggestion.title} in your games`
    : `Post to ${suggestion.title} — we'll add it to your games`;

  return (
    <View style={styles.suggestionBox} testID="share-game-detection-suggestion">
      <View style={styles.suggestionHeader}>
        <View style={styles.suggestionText}>
          <Text variant="label">{label} score detected</Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {destination}
          </Text>
        </View>
        <Button
          label="Post"
          size="md"
          disabled={pending || (check.available && !check.canPost)}
          loading={pending}
          onPress={onPost}
          testID="share-game-post-suggestion"
        />
      </View>
      <ScoreCheckPanel check={check} testID="share-game-check" />
    </View>
  );
}

function myGameTarget(mg: MyGame): ShareGameTarget {
  return { gameId: mg.gameId, title: mg.game.title, url: mg.game.url };
}

function targetKey(target: ShareGameTarget | undefined): string | null {
  if (!target) return null;
  return target.gameId ?? `url:${target.url}`;
}

function GameRow({
  title,
  subtitle,
  iconUrl,
  disabled,
  loading,
  onPress,
  testID,
}: {
  title: string;
  subtitle: string;
  iconUrl: Game["iconUrl"];
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Post score to ${title}`}
      accessibilityState={{ disabled, busy: loading }}
      onPress={disabled ? undefined : onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.gameRow,
        pressed && !disabled && styles.gameRowPressed,
        disabled && !loading && styles.disabledRow,
      ]}
    >
      {iconUrl ? (
        <Image
          source={{ uri: iconUrl }}
          style={styles.gameThumb}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.gameThumb, styles.gameThumbPlaceholder]}>
          <Text style={styles.gameThumbGlyph}>🏆</Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
          {title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator color={tokens.accent.default} size="small" />
      ) : (
        <Text style={styles.rowChevron}>{">"}</Text>
      )}
    </Pressable>
  );
}

function shortHost(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", padding: tokens.space.xl },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  suggestionBox: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
  },
  suggestionText: { flex: 1, minWidth: 0, gap: 2 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: tokens.space.sm },
  scoreBox: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.default,
  },
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
  },
  scoreInput: {
    minHeight: 116,
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderRadius: tokens.radius.md,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm,
    color: tokens.text.primary,
    fontSize: tokens.font.size.md,
    backgroundColor: tokens.bg.canvas,
    textAlignVertical: "top",
  },
  gameSectionHeader: { gap: 2 },
  gameSectionTitle: { fontSize: tokens.font.size.md },
  gameList: { gap: tokens.space.sm },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    backgroundColor: tokens.bg.canvas,
    minHeight: 76,
  },
  gameRowPressed: { backgroundColor: tokens.bg.surface },
  disabledRow: { opacity: 0.55 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: tokens.text.primary },
  rowChevron: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
  },
  gameThumb: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  gameThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  gameThumbGlyph: {
    fontSize: tokens.font.size.lg,
  },
});
