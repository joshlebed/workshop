import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Game, MyGame } from "@workshop/shared/games";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
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
import { addGame, fetchMyGames, upsertGameScore } from "../../src/api/games";
import { useAuth } from "../../src/hooks/useAuth";
import { errorMessage } from "../../src/lib/api";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import { localDateKey } from "../../src/lib/gameDate";
import { haptics } from "../../src/lib/haptics";
import { queryKeys } from "../../src/lib/queryKeys";
import {
  detectSharedScore,
  isResultlessShare,
  pickSuggestedGameTarget,
  type ShareGameTarget,
} from "../../src/lib/shareScoreDetection";
import { Button, EmptyState, Screen, Text, tokens, useToast } from "../../src/ui/index";

// The Games-surface score picker for the share flow (the leaderboard-list
// picker's successor): paste box + My Games rows. When the detected game
// isn't in My Games yet it's offered as a suggested row on top — posting
// find-or-creates the catalog game and the upsert auto-adds it to My Games.
export default function PickGame() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const sharedPayload = readSharedPayload(params);
  const [scoreDraft, setScoreDraft] = useState(sharedPayload);
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const detectedScore = useMemo(() => detectSharedScore(sharedPayload), [sharedPayload]);
  const today = localDateKey();

  const myGamesQuery = useQuery({
    queryKey: queryKeys.games.mine(today),
    queryFn: () => fetchMyGames(today, token),
    enabled: GAMES_TAB_ENABLED && !!token,
  });
  const myGames = myGamesQuery.data?.games ?? [];

  // The detected game, when it isn't already one of My Games rows.
  const suggestedTarget = useMemo(() => {
    const target = pickSuggestedGameTarget(detectedScore, myGames);
    return target && target.gameId === null ? target : null;
  }, [detectedScore, myGames]);

  const submitScore = useMutation({
    mutationFn: async (target: ShareGameTarget) => {
      const gameId = target.gameId ?? (await addGame(target.url, token)).game.id;
      return upsertGameScore(gameId, { periodKey: today, scoreRaw: scoreDraft.trim() }, token);
    },
    onSuccess: async () => {
      haptics.medium();
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      showToast({ message: "Score posted", tone: "success" });
      router.replace("/games");
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't post score"), tone: "danger" });
    },
  });

  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }

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
      router.replace("/");
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
          <Text style={styles.navGlyph}>x</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" style={styles.title}>
            Post to your Games
          </Text>
          <View style={styles.payloadPill} testID="share-game-payload">
            <View style={styles.payloadDot} />
            <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.payloadText}>
              {detectedScore ? `${detectedScore.gameLabel} score detected` : "Score share"}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
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
            Pick the game to update.
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
        ) : myGames.length === 0 && !suggestedTarget ? (
          <EmptyState
            title="No games yet"
            description="Add games on the Games tab, then share a score to post it here."
            action={<Button label="Open Games" onPress={() => router.replace("/games")} />}
          />
        ) : (
          <View style={styles.gameList}>
            {suggestedTarget ? (
              <GameRow
                key="suggested"
                title={suggestedTarget.title}
                subtitle="Adds to My Games"
                iconUrl={null}
                testID="share-game-suggested"
                {...rowState(suggestedTarget)}
                onPress={() => postScore(suggestedTarget)}
              />
            ) : null}
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
    borderRadius: tokens.radius.md,
  },
  navButtonPressed: { backgroundColor: tokens.bg.elevated },
  navGlyph: {
    color: tokens.text.primary,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
  },
  headerTitleBlock: { flex: 1, minWidth: 0, gap: tokens.space.xs, paddingTop: 4 },
  title: { fontSize: tokens.font.size.xl },
  payloadPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: tokens.space.md,
    paddingVertical: 4,
    borderRadius: tokens.radius.pill,
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
