import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Item, ListSummary } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { fetchItems } from "../../src/api/items";
import { fetchLists } from "../../src/api/lists";
import { upsertItemScore } from "../../src/api/scores";
import { PullToRefresh } from "../../src/components/PullToRefresh";
import { useAuth } from "../../src/hooks/useAuth";
import { errorMessage } from "../../src/lib/api";
import { localDateKey } from "../../src/lib/gameDate";
import { haptics } from "../../src/lib/haptics";
import { queryKeys } from "../../src/lib/queryKeys";
import { detectSharedScore, flattenListItems } from "../../src/lib/shareScoreDetection";
import {
  Button,
  EmptyState,
  type ListColorKey,
  Screen,
  Text,
  tokens,
  useToast,
} from "../../src/ui/index";

export default function PickLeaderboard() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const sharedPayload = readSharedPayload(params);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [scoreDraft, setScoreDraft] = useState(sharedPayload);
  const router = useRouter();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const detectedScore = useMemo(() => detectSharedScore(sharedPayload), [sharedPayload]);

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });

  const leaderboardLists = useMemo(() => {
    const data = listsQuery.data?.lists ?? [];
    return [...data]
      .filter((list) => list.modules.includes("leaderboard"))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [listsQuery.data]);

  const selectedList = leaderboardLists.find((list) => list.id === selectedListId) ?? null;

  const itemsQuery = useQuery({
    queryKey: queryKeys.items.byList(selectedListId ?? ""),
    queryFn: () => fetchItems(selectedListId ?? "", token),
    enabled: !!token && !!selectedListId,
  });

  const games = useMemo(() => flattenListItems(itemsQuery.data), [itemsQuery.data]);
  const today = localDateKey();

  const submitScore = useMutation({
    mutationFn: ({ item, list }: { item: Item; list: ListSummary }) =>
      upsertItemScore(item.id, { periodKey: today, scoreRaw: scoreDraft.trim() }, token).then(
        (response) => ({ response, item, list }),
      ),
    onSuccess: async ({ item, list }) => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.gameScores.forItem(item.id, today) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.gameScores.forList(list.id, today) }),
      ]);
      showToast({ message: "Score posted", tone: "success" });
      router.replace(`/list/${list.id}/game/${item.id}`);
    },
    onError: (e) => {
      showToast({ message: errorMessage(e, "Couldn't post score"), tone: "danger" });
    },
  });

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  const onBack = () => {
    setSelectedListId(null);
    submitScore.reset();
  };

  const canPost = scoreDraft.trim().length > 0 && !submitScore.isPending;
  const pendingItemId = submitScore.isPending ? submitScore.variables?.item.id : null;

  return (
    <Screen style={styles.root} testID="share-pick-leaderboard">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selectedList ? "Back to leaderboard lists" : "Cancel"}
          onPress={selectedList ? onBack : onCancel}
          testID={selectedList ? "share-leaderboard-back" : "share-leaderboard-cancel"}
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <Text style={styles.navGlyph}>{selectedList ? "<" : "x"}</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" style={styles.title}>
            {selectedList ? "Choose game" : "Add to a leaderboard"}
          </Text>
          <View style={styles.payloadPill} testID="share-leaderboard-payload">
            <View style={styles.payloadDot} />
            <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.payloadText}>
              {detectedScore ? `${detectedScore.gameLabel} score detected` : "Score share"}
            </Text>
          </View>
        </View>
      </View>

      {selectedList ? (
        <GamePicker
          list={selectedList}
          scoreDraft={scoreDraft}
          onChangeScoreDraft={setScoreDraft}
          itemsQuery={itemsQuery}
          games={games}
          canPost={canPost}
          pendingItemId={pendingItemId}
          onPost={(item) => submitScore.mutate({ item, list: selectedList })}
          onAddGame={() => router.push(`/list/${selectedList.id}/add`)}
        />
      ) : (
        <LeaderboardListPicker
          listsQuery={listsQuery}
          lists={leaderboardLists}
          sharedPayload={sharedPayload}
          onPick={setSelectedListId}
          onCreateNew={() => router.replace("/create-list/type")}
        />
      )}
    </Screen>
  );
}

function LeaderboardListPicker({
  listsQuery,
  lists,
  sharedPayload,
  onPick,
  onCreateNew,
}: {
  listsQuery: ReturnType<typeof useQuery<{ lists: ListSummary[] }, Error>>;
  lists: ListSummary[];
  sharedPayload: string;
  onPick: (listId: string) => void;
  onCreateNew: () => void;
}) {
  if (listsQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (listsQuery.isError) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Couldn't load leaderboards"
          description={errorMessage(listsQuery.error)}
          action={<Button label="Retry" variant="secondary" onPress={() => listsQuery.refetch()} />}
        />
      </View>
    );
  }

  if (lists.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="No leaderboard lists"
          description="Create a list with Leaderboard enabled to save scores."
          action={<Button label="Create a list" onPress={onCreateNew} />}
        />
      </View>
    );
  }

  return (
    <PullToRefresh refreshing={listsQuery.isRefetching} onRefresh={() => listsQuery.refetch()}>
      <FlatList
        testID="share-leaderboard-list"
        data={lists}
        keyExtractor={(list) => list.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
        ListHeaderComponent={
          sharedPayload ? (
            <Text variant="caption" tone="muted" style={styles.sectionIntro}>
              Choose the list that owns this game.
            </Text>
          ) : null
        }
        renderItem={({ item }) => <ListRow list={item} onPress={() => onPick(item.id)} />}
      />
    </PullToRefresh>
  );
}

function GamePicker({
  list,
  scoreDraft,
  onChangeScoreDraft,
  itemsQuery,
  games,
  canPost,
  pendingItemId,
  onPost,
  onAddGame,
}: {
  list: ListSummary;
  scoreDraft: string;
  onChangeScoreDraft: (value: string) => void;
  itemsQuery: ReturnType<typeof useQuery<unknown, Error>>;
  games: Item[];
  canPost: boolean;
  pendingItemId: string | null | undefined;
  onPost: (item: Item) => void;
  onAddGame: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.gameBody}
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
          testID="share-leaderboard-score-input"
          value={scoreDraft}
          onChangeText={onChangeScoreDraft}
          placeholder="Paste score text"
          placeholderTextColor={tokens.text.muted}
          multiline
          maxLength={2000}
          style={styles.scoreInput}
        />
      </View>

      <View style={styles.gameSectionHeader}>
        <Text variant="heading" style={styles.gameSectionTitle}>
          {list.name}
        </Text>
        <Text variant="caption" tone="muted">
          Pick the game to update.
        </Text>
      </View>

      {itemsQuery.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={tokens.accent.default} />
        </View>
      ) : itemsQuery.isError ? (
        <EmptyState
          title="Couldn't load games"
          description={errorMessage(itemsQuery.error)}
          action={<Button label="Retry" variant="secondary" onPress={() => itemsQuery.refetch()} />}
        />
      ) : games.length === 0 ? (
        <EmptyState
          title="No games yet"
          description="Add a game to this leaderboard before posting scores."
          action={<Button label="Add game" onPress={onAddGame} />}
        />
      ) : (
        <View style={styles.gameList}>
          {games.map((item) => (
            <GameRow
              key={item.id}
              item={item}
              disabled={!canPost || (pendingItemId !== null && pendingItemId !== item.id)}
              loading={pendingItemId === item.id}
              onPress={() => onPost(item)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ListRow({ list, onPress }: { list: ListSummary; onPress: () => void }) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const itemsLabel =
    list.itemCount === 0
      ? "No games"
      : `${list.itemCount} ${list.itemCount === 1 ? "game" : "games"}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choose ${list.name}`}
      onPress={onPress}
      testID={`share-leaderboard-row-${list.id}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.avatar, { backgroundColor: `${accent}1F` }]}>
        <Text style={styles.avatarEmoji}>{list.emoji}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
          {list.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {itemsLabel}
        </Text>
      </View>
      <Text style={styles.rowChevron}>{">"}</Text>
    </Pressable>
  );
}

function GameRow({
  item,
  disabled,
  loading,
  onPress,
}: {
  item: Item;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const thumb = thumbnailUrl(item);
  const host = shortHost(item.url);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Post score to ${item.title}`}
      accessibilityState={{ disabled, busy: loading }}
      onPress={disabled ? undefined : onPress}
      testID={`share-leaderboard-game-${item.id}`}
      style={({ pressed }) => [
        styles.gameRow,
        pressed && !disabled && styles.gameRowPressed,
        disabled && !loading && styles.disabledRow,
      ]}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.gameThumb} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.gameThumb, styles.gameThumbPlaceholder]}>
          <Text style={styles.gameThumbGlyph}>#</Text>
        </View>
      )}
      <View style={styles.rowBody}>
        <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
          {item.title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {host ?? "Leaderboard game"}
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

function thumbnailUrl(item: Item): string | null {
  const value = item.content.thumbnailUrl;
  return typeof value === "string" && value.length > 0 ? value : null;
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: tokens.space.xl },
  listContent: { paddingBottom: tokens.space.xxl },
  sectionIntro: { paddingHorizontal: tokens.space.lg, paddingVertical: tokens.space.sm },
  rowSeparator: {
    height: 1,
    backgroundColor: tokens.border.subtle,
    marginLeft: tokens.space.lg + 44 + tokens.space.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  rowPressed: { backgroundColor: tokens.bg.surface },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEmoji: { fontSize: 22 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: tokens.text.primary },
  rowChevron: {
    color: tokens.text.muted,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.semibold,
  },
  gameBody: {
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
  gameThumb: {
    width: 44,
    height: 44,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.bg.elevated,
  },
  gameThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  gameThumbGlyph: {
    color: tokens.accent.default,
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.bold,
  },
});
