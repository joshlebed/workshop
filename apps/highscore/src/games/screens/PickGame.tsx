import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, MyGame } from "@workshop/shared/games";
import { haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Button, Notice, PixelIcon, Screen, Text, tokens, useToast } from "../../theme";
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

// The Games-surface score picker for the share flow (the leaderboard-list
// picker's successor): a detected-score card with a one-tap Post button, a
// paste box, and My Games rows. When the detected game isn't in My Games yet,
// posting find-or-creates the catalog game and the upsert auto-adds it.
export default function PickGame() {
  const params = useLocalSearchParams<{ url?: string; text?: string; via?: string }>();
  const sharedPayload = readSharedPayload(params);
  // Provenance for the score write: only the share-intent redirect in
  // _layout.tsx sets `via=share-extension`, so its presence means the payload
  // arrived through the iOS share sheet (vs. a manual visit / in-app paste).
  const entrySource = firstParam(params.via) === "share-extension" ? "share_extension" : "paste";
  const [scoreDraft, setScoreDraft] = useState(sharedPayload);
  const router = useRouter();
  const { token, routes } = useGamesRuntime();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Detect against the live draft, not the frozen share payload: the paste box
  // lives on this screen, so filling in a result the iOS share sheet dropped
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
      router.replace(routes.home as Href);
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

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(routes.root as Href);
    }
  };

  const canPost = scoreDraft.trim().length > 0 && !submitScore.isPending;
  const pendingKey = submitScore.isPending ? targetKey(submitScore.variables) : null;
  const rowState = (target: ShareGameTarget) => ({
    disabled: !canPost || (pendingKey !== null && pendingKey !== targetKey(target)),
    loading: pendingKey === targetKey(target),
  });

  return (
    <Screen style={styles.root} testID="share-pick-game">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          testID="share-game-cancel"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <PixelIcon name="close" size={24} color={tokens.text.primary} />
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" style={styles.title}>
            Post to your Games
          </Text>
          <View style={styles.payloadPill} testID="share-game-payload">
            <View style={styles.payloadDot} />
            <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.payloadText}>
              {detected
                ? `${detected.gameLabel} ${resultlessDraft ? "link" : "score"} detected`
                : "Score share"}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
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
            resultless={resultlessDraft || serverResultless}
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
          <Notice
            title="Couldn't load your games"
            description={errorMessage(myGamesQuery.error)}
            action={
              <Button label="Retry" variant="secondary" onPress={() => myGamesQuery.refetch()} />
            }
          />
        ) : myGames.length === 0 ? (
          <Notice
            title="No games yet"
            description={
              suggestion
                ? `Post above and we'll add ${suggestion.title} to your games.`
                : "Add games on the Games tab, then share a score to post it here."
            }
            action={
              suggestion ? undefined : (
                <Button label="Open Games" onPress={() => router.replace(routes.home as Href)} />
              )
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
          </View>
        )}
      </ScrollView>
    </Screen>
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

function readSharedPayload(params: { url?: string | string[]; text?: string | string[] }): string {
  const text = firstParam(params.text);
  if (text) return text;
  return firstParam(params.url) ?? "";
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
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
  root: {
    backgroundColor: tokens.bg.canvas,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    paddingRight: tokens.space.lg,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  headerTitleBlock: { flex: 1, minWidth: 0, gap: tokens.space.xs, paddingTop: 4 },
  title: { fontSize: 13, lineHeight: 20 },
  payloadPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 4,
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.border.subtle,
    maxWidth: "100%",
  },
  payloadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.accent.default,
  },
  payloadText: { flexShrink: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: tokens.space.xl },
  body: {
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  suggestionBox: {
    gap: tokens.space.sm,
    padding: tokens.space.md,
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
    backgroundColor: tokens.bg.elevated,
  },
  gameThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  gameThumbGlyph: {
    fontSize: tokens.font.size.lg,
  },
});
