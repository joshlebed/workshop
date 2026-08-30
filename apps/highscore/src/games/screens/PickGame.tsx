import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { Game, MyGame } from "@workshop/shared/games";
import { haptics, Screen, useToast } from "@workshop/ui";
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
import { HsButton, HsText, hs, hsBezel, PixelIcon } from "../../theme";
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
  const [inputFocused, setInputFocused] = useState(false);
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
          <PixelIcon name="close" size={16} color={hs.color.textPrimary} />
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <HsText variant="pixelTitle">Post to your Games</HsText>
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
            placeholderTextColor={hs.color.textSecondary}
            multiline
            maxLength={2000}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            style={[styles.scoreInput, inputFocused && styles.scoreInputFocused]}
          />
        </View>

        <View style={styles.gameSectionHeader}>
          <HsText variant="heading">Your games</HsText>
          <HsText variant="caption" tone="secondary">
            {suggestion ? "Or pick a different game." : "Pick the game to update."}
          </HsText>
        </View>

        {myGamesQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={hs.color.primary} />
          </View>
        ) : myGamesQuery.isError ? (
          <EmptyBox
            title="Couldn't load your games"
            description={errorMessage(myGamesQuery.error)}
            action={
              <HsButton label="Retry" variant="secondary" onPress={() => myGamesQuery.refetch()} />
            }
          />
        ) : myGames.length === 0 ? (
          <EmptyBox
            title="No games yet"
            description={
              suggestion
                ? `Post above and we'll add ${suggestion.title} to your games.`
                : "Add games on the Games tab, then share a score to post it here."
            }
            action={
              suggestion ? undefined : (
                <HsButton
                  label="Open Games"
                  variant="secondary"
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
                  selected={!!suggestion?.gameId && suggestion.gameId === mg.gameId}
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
          <ActivityIndicator color={hs.color.primary} size="small" />
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
    <View
      style={[styles.suggestionBox, styles.suggestionBoxActive]}
      testID="share-game-detection-suggestion"
    >
      <View style={styles.suggestionHeader}>
        <View style={styles.suggestionText}>
          <HsText variant="label">{label} score detected</HsText>
          <HsText variant="caption" tone="secondary" numberOfLines={2}>
            {destination}
          </HsText>
        </View>
        <HsButton
          label="Post"
          variant="primary"
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

// Sharp-cornered replacement for the old @workshop/ui EmptyState: a quiet
// surface1 card with a system heading and caption.
function EmptyBox({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.emptyBox}>
      <HsText variant="heading" style={styles.emptyTitle}>
        {title}
      </HsText>
      <HsText variant="caption" tone="secondary" style={styles.emptyDescription}>
        {description}
      </HsText>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
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
  selected,
  disabled,
  loading,
  onPress,
  testID,
}: {
  title: string;
  subtitle: string;
  iconUrl: Game["iconUrl"];
  selected: boolean;
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
        selected && styles.gameRowSelected,
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
        <HsText variant="label" numberOfLines={1}>
          {title}
        </HsText>
        <HsText variant="caption" tone="secondary" numberOfLines={1}>
          {subtitle}
        </HsText>
      </View>
      {loading ? (
        <ActivityIndicator color={hs.color.primary} size="small" />
      ) : (
        <PixelIcon name="chevron-right" size={16} />
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
    backgroundColor: hs.color.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: hs.space.xs,
    paddingHorizontal: hs.space.sm,
    paddingRight: hs.space.lg,
    paddingTop: hs.space.xl,
    paddingBottom: hs.space.sm,
  },
  navButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: hs.radius.hard,
  },
  navButtonPressed: { backgroundColor: hs.color.surface3 },
  headerTitleBlock: { flex: 1, minWidth: 0, gap: hs.space.sm, paddingTop: 4 },
  payloadPill: {
    ...hsBezel,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: hs.space.md,
    paddingVertical: 4,
    backgroundColor: hs.color.surface1,
    maxWidth: "100%",
  },
  payloadDot: {
    width: 6,
    height: 6,
    backgroundColor: hs.color.primary,
  },
  payloadText: { flexShrink: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: hs.space.xl },
  body: {
    paddingHorizontal: hs.space.lg,
    paddingBottom: hs.space.xxl,
    gap: hs.space.lg,
  },
  suggestionBox: {
    ...hsBezel,
    gap: hs.space.sm,
    padding: hs.space.md,
    backgroundColor: hs.color.surface1,
  },
  suggestionBoxActive: { borderLeftColor: hs.color.primary },
  suggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: hs.space.md,
  },
  suggestionText: { flex: 1, minWidth: 0, gap: 2 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: hs.space.sm },
  scoreBox: {
    ...hsBezel,
    gap: hs.space.sm,
    padding: hs.space.md,
    backgroundColor: hs.color.surface1,
  },
  scoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: hs.space.md,
  },
  scoreInput: {
    borderWidth: hs.bezel,
    borderColor: hs.color.border,
    borderRadius: hs.radius.hard,
    minHeight: 116,
    paddingHorizontal: hs.space.md,
    paddingVertical: hs.space.sm,
    color: hs.color.textPrimary,
    fontSize: hs.font.size.md,
    backgroundColor: hs.color.surface2,
    textAlignVertical: "top",
  },
  scoreInputFocused: { borderColor: hs.color.primary },
  gameSectionHeader: { gap: 2 },
  gameList: { gap: hs.space.sm },
  gameRow: {
    ...hsBezel,
    flexDirection: "row",
    alignItems: "center",
    gap: hs.space.md,
    padding: hs.space.md,
    backgroundColor: hs.color.surface1,
    minHeight: 76,
  },
  gameRowSelected: { borderLeftColor: hs.color.primary },
  gameRowPressed: { backgroundColor: hs.color.surface3 },
  disabledRow: { opacity: 0.55 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  emptyBox: {
    ...hsBezel,
    alignItems: "center",
    gap: hs.space.sm,
    padding: hs.space.xl,
    backgroundColor: hs.color.surface1,
  },
  emptyTitle: { textAlign: "center" },
  emptyDescription: { textAlign: "center" },
  emptyAction: { marginTop: hs.space.xs },
  gameThumb: {
    width: 44,
    height: 44,
    borderRadius: hs.radius.hard,
    backgroundColor: hs.color.surface2,
  },
  gameThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  gameThumbGlyph: {
    fontSize: hs.font.size.lg,
  },
});
