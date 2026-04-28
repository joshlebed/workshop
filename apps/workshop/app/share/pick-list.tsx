import { useQuery } from "@tanstack/react-query";
import type { ListSummary, ListType } from "@workshop/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { fetchLists } from "../../src/api/lists";
import { useAuth } from "../../src/hooks/useAuth";
import { queryKeys } from "../../src/lib/queryKeys";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  type ListColorKey,
  Text,
  tokens,
} from "../../src/ui/index";

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
};

// Lists that pair naturally with a shared URL (free-form items take a URL +
// link preview). Search-flow lists (movie/tv/book) ignore prefillUrl in
// add.tsx, so we visually de-emphasise them here.
const URL_FRIENDLY: ReadonlySet<ListType> = new Set<ListType>(["date_idea", "trip"]);

export default function PickList() {
  const params = useLocalSearchParams<{ url?: string }>();
  const sharedUrl = Array.isArray(params.url) ? params.url[0] : params.url;
  const router = useRouter();
  const { token } = useAuth();

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });

  const onPick = (list: ListSummary) => {
    const target = sharedUrl
      ? (`/list/${list.id}/add?prefillUrl=${encodeURIComponent(sharedUrl)}` as const)
      : (`/list/${list.id}/add` as const);
    router.replace(target);
  };

  const onCreateNew = () => {
    router.replace("/create-list/type");
  };

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <IconButton accessibilityLabel="Cancel" onPress={onCancel} testID="share-pick-cancel">
          <Text style={styles.headerGlyph}>✕</Text>
        </IconButton>
        <Text variant="heading">Add to a list</Text>
        <View style={styles.headerSpacer} />
      </View>

      {sharedUrl ? (
        <Text tone="secondary" style={styles.urlPreview} numberOfLines={1} testID="share-pick-url">
          {sharedUrl}
        </Text>
      ) : null}

      <View style={styles.body}>
        {listsQuery.isPending ? (
          <View style={styles.center}>
            <ActivityIndicator color={tokens.accent.default} />
          </View>
        ) : listsQuery.isError ? (
          <View style={styles.center}>
            <EmptyState
              title="Couldn't load your lists"
              description={errorMessage(listsQuery.error)}
              action={
                <Button label="Retry" variant="secondary" onPress={() => listsQuery.refetch()} />
              }
            />
          </View>
        ) : listsQuery.data.lists.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              title="No lists yet"
              description="Create your first list to save this."
              action={<Button label="Create a list" onPress={onCreateNew} />}
            />
          </View>
        ) : (
          <FlatList
            testID="share-pick-list"
            data={listsQuery.data.lists}
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: tokens.space.sm }} />}
            renderItem={({ item }) => <ListRow list={item} onPress={() => onPick(item)} />}
            ListFooterComponent={
              <Pressable
                accessibilityRole="button"
                onPress={onCreateNew}
                testID="share-pick-create-new"
                style={({ pressed }) => [pressed && styles.cardPressed]}
              >
                <Card style={styles.createCard}>
                  <Text style={styles.createGlyph}>+</Text>
                  <Text variant="heading" style={styles.createLabel}>
                    Create new list
                  </Text>
                </Card>
              </Pressable>
            }
          />
        )}
      </View>
    </View>
  );
}

function ListRow({ list, onPress }: { list: ListSummary; onPress: () => void }) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const dim = !URL_FRIENDLY.has(list.type);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add to ${list.name}`}
      onPress={onPress}
      testID={`share-pick-row-${list.id}`}
      style={({ pressed }) => [pressed && styles.cardPressed]}
    >
      <Card style={[styles.card, dim && styles.cardDim]}>
        <View style={[styles.cardStripe, { backgroundColor: accent }]} />
        <View style={styles.cardBody}>
          <Text style={styles.cardEmoji}>{list.emoji}</Text>
          <View style={styles.cardTextBlock}>
            <Text variant="heading" numberOfLines={1}>
              {list.name}
            </Text>
            <Text variant="caption" tone="muted">
              {TYPE_LABEL[list.type]}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown error";
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.xxl,
    paddingBottom: tokens.space.xl,
    gap: tokens.space.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerSpacer: { width: 40 },
  urlPreview: {
    paddingHorizontal: tokens.space.sm,
    paddingBottom: tokens.space.sm,
  },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: tokens.space.xxl },
  card: { padding: 0, overflow: "hidden", flexDirection: "row" },
  cardDim: { opacity: 0.6 },
  cardPressed: { opacity: 0.85 },
  cardStripe: { width: 4 },
  cardBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    padding: tokens.space.md,
  },
  cardEmoji: { fontSize: tokens.font.size.xl },
  cardTextBlock: { flex: 1, gap: 2 },
  createCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.sm,
    padding: tokens.space.md,
    marginTop: tokens.space.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: tokens.border.default,
    backgroundColor: tokens.bg.canvas,
  },
  createGlyph: {
    fontSize: tokens.font.size.lg,
    color: tokens.accent.default,
    fontWeight: tokens.font.weight.bold,
  },
  createLabel: { color: tokens.accent.default },
});
