import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, MyGame } from "@workshop/shared/games";
import { EmptyState, haptics, Screen, useToast } from "@workshop/ui";
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
import {
  HsText,
  hsBezel,
  hsColor,
  hsSpace,
  PixelButton,
  PixelCorners,
  PixelDivider,
  PixelIcon,
} from "../../theme";
import { addGame, fetchMyGames, upsertGameScore } from "../api/games";
import { localDateKey } from "../lib/gameDate";
import {
  detectSharedScore,
  isResultlessShare,
  pickSuggestedGameTarget,
  type ShareGameTarget,
} from "../lib/shareScoreDetection";
import { useGamesRuntime } from "../runtime";

// The Games-surface score picker for the share flow (the leaderboard-list
// picker's successor): a detected-score card with a one-tap Post button, a
// paste box, and My Games rows. When the detected game isn't in My Games yet,
// posting find-or-creates the catalog game and the upsert auto-adds it.
export default function PickGame() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const sharedPayload = readSharedPayload(params);
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

  // Where a detected score posts: the matching My Games row when there is one,
  // otherwise the registry's canonical URL (find-or-create on post).
  const suggestion = useMemo(
    () => pickSuggestedGameTarget(detectedScore, myGames),
    [detectedScore, myGames],
  );
  const suggestionLoading = !!detectedScore && !!token && myGamesQuery.isPending && !suggestion;

  const submitScore = useMutation({
    mutationFn: async (target: ShareGameTarget) => {
      const gameId = target.gameId ?? (await addGame(target.url, token)).game.id;
      return upsertGameScore(gameId, { periodKey: today, scoreRaw: scoreDraft.trim() }, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({ message: "Score posted", tone: "success" });
      router.replace(routes.home as Href);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't post score"), tone: "danger" });
    },
  });

  const postScore = (target: ShareGameTarget) => {
    if (isResultlessShare(scoreDraft)) {
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
          <PixelIcon name="close" size={24} color={hsColor.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <HsText variant="pixelTitle" style={styles.title}>
            Post to your Games
          </HsText>
          <View style={styles.payloadPill} testID="share-game-payload">
            <View style={styles.payloadDot} />
            <HsText variant="caption" tone="secondary" numberOfLines={1} style={styles.payloadText}>
              {detectedScore
                ? `${detectedScore.gameLabel} ${resultlessDraft ? "link" : "score"} detected`
                : "Score share"}
            </HsText>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {detectedScore ? (
          <DetectedScoreSuggestion
            label={detectedScore.gameLabel}
            suggestion={suggestion}
            loading={suggestionLoading}
            pending={submitScore.isPending}
            resultless={resultlessDraft}
            onPost={() => {
              if (suggestion) postScore(suggestion);
            }}
          />
        ) : null}

        <View style={styles.scoreBox}>
          <View style={styles.scoreHeader}>
            <HsText variant="label">Score</HsText>
            <HsText variant="caption" tone="secondary">
              Posts to today
            </HsText>
          </View>
          <TextInput
            testID="share-game-score-input"
            value={scoreDraft}
            onChangeText={setScoreDraft}
            placeholder="Paste score text"
            placeholderTextColor={hsColor.textSecondary}
            multiline
            maxLength={2000}
            style={styles.scoreInput}
          />
        </View>

        <PixelDivider />

        <View style={styles.gameSectionHeader}>
          <HsText variant="pixelHeading" style={styles.gameSectionTitle}>
            Your games
          </HsText>
          <HsText variant="caption" tone="secondary">
            {suggestion ? "Or pick a different game." : "Pick the game to update."}
          </HsText>
        </View>

        {myGamesQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={hsColor.primary} />
          </View>
        ) : myGamesQuery.isError ? (
          <EmptyState
            title="Couldn't load your games"
            description={errorMessage(myGamesQuery.error)}
            action={
              <PixelButton
                label="Retry"
                variant="secondary"
                onPress={() => myGamesQuery.refetch()}
              />
            }
          />
        ) : myGames.length === 0 ? (
          <EmptyState
            title="No games yet"
            description={
              suggestion
                ? `Post above and we'll add ${suggestion.title} to your games.`
                : "Add games on the Games tab, then share a score to post it here."
            }
            action={
              suggestion ? undefined : (
                <PixelButton
                  label="Open Games"
                  onPress={() => router.replace(routes.home as Href)}
                />
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
  onPost,
}: {
  label: string;
  suggestion: ShareGameTarget | null;
  loading: boolean;
  pending: boolean;
  resultless: boolean;
  onPost: () => void;
}) {
  // The share carried the game's link but not the result text. Don't offer
  // one-tap post — the paste field is right below, so ask for the result.
  if (resultless) {
    return (
      <View style={styles.suggestionBox} testID="share-game-detection-resultless">
        <HsText variant="label">{label} link detected</HsText>
        <HsText variant="caption" tone="secondary">
          We got the link but not your result. Paste your result below to post a score.
        </HsText>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.suggestionBox} testID="share-game-detection-loading">
        <View style={styles.loadingRow}>
          <ActivityIndicator color={hsColor.primary} size="small" />
          <HsText variant="label">{label} score detected</HsText>
        </View>
        <HsText variant="caption" tone="secondary">
          Looking for a matching game.
        </HsText>
      </View>
    );
  }

  if (!suggestion) {
    return (
      <View style={styles.suggestionBox} testID="share-game-detection-empty">
        <HsText variant="label">{label} score detected</HsText>
        <HsText variant="caption" tone="secondary">
          Pick where to post it below.
        </HsText>
      </View>
    );
  }

  const destination = suggestion.gameId
    ? `Post to ${suggestion.title} in your games`
    : `Post to ${suggestion.title} — we'll add it to your games`;

  return (
    <View style={styles.suggestionBox} testID="share-game-detection-suggestion">
      <PixelCorners cutColor={hsColor.bg} bezelColor={hsColor.border} />
      <View style={styles.suggestionHeader}>
        <View style={styles.suggestionText}>
          <HsText variant="label">{label} score detected</HsText>
          <HsText variant="caption" tone="secondary" numberOfLines={2}>
            {destination}
          </HsText>
        </View>
        <PixelButton
          label="Post"
          size="md"
          disabled={pending}
          loading={pending}
          onPress={onPost}
          testID="share-game-post-suggestion"
        />
      </View>
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
          <HsText style={styles.gameThumbGlyph}>🏆</HsText>
        </View>
      )}
      <View style={styles.rowBody}>
        <HsText variant="label" numberOfLines={1} style={styles.rowTitle}>
          {title}
        </HsText>
        <HsText variant="caption" tone="secondary" numberOfLines={1}>
          {subtitle}
        </HsText>
      </View>
      {loading ? (
        <ActivityIndicator color={hsColor.primary} size="small" />
      ) : (
        <PixelIcon name="chevron-right" size={16} color={hsColor.textSecondary} />
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
    backgroundColor: hsColor.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: hsSpace.xs,
    paddingHorizontal: hsSpace.sm,
    paddingRight: hsSpace.lg,
    paddingTop: hsSpace.xl,
    paddingBottom: hsSpace.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
  },
  navButtonPressed: { backgroundColor: hsColor.surface2 },
  headerTitleBlock: { flex: 1, minWidth: 0, gap: hsSpace.sm, paddingTop: 4 },
  title: { fontSize: 16, lineHeight: 26 },
  payloadPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: hsSpace.md,
    paddingVertical: 4,
    borderRadius: 0,
    backgroundColor: hsColor.surface2,
    borderWidth: 1,
    borderColor: hsColor.border,
    maxWidth: "100%",
  },
  // Detection status marker — a square pixel dot, pink like the live signal.
  payloadDot: {
    width: 6,
    height: 6,
    borderRadius: 0,
    backgroundColor: hsColor.primary,
  },
  payloadText: { flexShrink: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: hsSpace.xl },
  body: {
    paddingHorizontal: hsSpace.lg,
    paddingBottom: hsSpace.xxl,
    gap: hsSpace.lg,
  },
  suggestionBox: {
    gap: hsSpace.sm,
    padding: hsSpace.md,
    borderRadius: 0,
    backgroundColor: hsColor.surface1,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
  },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.md,
  },
  suggestionText: { flex: 1, minWidth: 0, gap: 2 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: hsSpace.sm },
  scoreBox: {
    gap: hsSpace.sm,
    padding: hsSpace.md,
    borderRadius: 0,
    backgroundColor: hsColor.surface1,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
  },
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: hsSpace.md,
  },
  scoreInput: {
    minHeight: 116,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
    borderRadius: 0,
    paddingHorizontal: hsSpace.md,
    paddingVertical: hsSpace.sm,
    color: hsColor.textPrimary,
    fontSize: 16,
    backgroundColor: hsColor.bg,
    textAlignVertical: "top",
  },
  gameSectionHeader: { gap: 2 },
  gameSectionTitle: { fontSize: 12, lineHeight: 19 },
  gameList: { gap: hsSpace.sm },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: hsSpace.md,
    padding: hsSpace.md,
    borderRadius: 0,
    borderWidth: hsBezel,
    borderColor: hsColor.border,
    backgroundColor: hsColor.surface1,
    minHeight: 76,
  },
  gameRowPressed: { backgroundColor: hsColor.surface2 },
  disabledRow: { opacity: 0.55 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: hsColor.textPrimary },
  gameThumb: {
    width: 44,
    height: 44,
    borderRadius: 0,
    backgroundColor: hsColor.surface2,
    borderWidth: 1,
    borderColor: hsColor.border,
  },
  gameThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  gameThumbGlyph: {
    fontSize: 18,
    lineHeight: 24,
  },
});
