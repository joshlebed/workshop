import { useQuery } from "@tanstack/react-query";
import type { ListSummary, ListType } from "@workshop/shared";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { fetchLists } from "../src/api/lists";
import { useAuth } from "../src/hooks/useAuth";
import { queryKeys } from "../src/lib/queryKeys";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  type ListColorKey,
  Text,
  tokens,
  useToast,
} from "../src/ui/index";

const TYPE_LABEL: Record<ListType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  date_idea: "Date ideas",
  trip: "Trips",
};

export default function Home() {
  const { user, token, signOut } = useAuth();
  const { showToast } = useToast();
  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });

  const onCreateList = () => {
    showToast({
      message: "Create-list flow lands in 1b-2.",
      tone: "default",
      actionLabel: "OK",
    });
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text variant="heading">Workshop.dev</Text>
          <Text tone="secondary" testID="home-greeting">
            {user?.displayName ? `Hi, ${user.displayName}` : "Signed in"}
          </Text>
        </View>
        <IconButton accessibilityLabel="Sign out" onPress={signOut} testID="sign-out">
          <Text tone="secondary" style={styles.signOutGlyph}>
            ⎋
          </Text>
        </IconButton>
      </View>

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
              description="Create your first list to start collecting movies, books, trips, or date ideas."
              action={<Button label="Create a list" onPress={onCreateList} />}
            />
          </View>
        ) : (
          <FlatList
            data={listsQuery.data.lists}
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: tokens.space.md }} />}
            renderItem={({ item }) => <ListCard list={item} />}
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          />
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create new list"
        onPress={onCreateList}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        testID="fab-create-list"
      >
        <Text style={styles.fabGlyph} tone="onAccent">
          +
        </Text>
      </Pressable>
    </View>
  );
}

function ListCard({ list }: { list: ListSummary }) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  return (
    <Card style={styles.card}>
      <View style={[styles.cardStripe, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <Text style={styles.cardEmoji}>{list.emoji}</Text>
          <View style={styles.cardTitleBlock}>
            <Text variant="heading" numberOfLines={1}>
              {list.name}
            </Text>
            <Text variant="caption" tone="muted">
              {TYPE_LABEL[list.type]} · {list.role === "owner" ? "Owner" : "Member"}
            </Text>
          </View>
        </View>
        {list.description ? (
          <Text tone="secondary" numberOfLines={2}>
            {list.description}
          </Text>
        ) : null}
        <View style={styles.cardMeta}>
          <Text variant="caption" tone="muted">
            {pluralize(list.itemCount, "item")}
          </Text>
          <Text variant="caption" tone="muted">
            ·
          </Text>
          <Text variant="caption" tone="muted">
            {pluralize(list.memberCount, "member")}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
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
    gap: tokens.space.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
  },
  signOutGlyph: { fontSize: tokens.font.size.lg },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: tokens.space.xxl * 2 },
  card: { padding: 0, overflow: "hidden", flexDirection: "row" },
  cardStripe: { width: 6 },
  cardBody: { flex: 1, padding: tokens.space.lg, gap: tokens.space.sm },
  cardHead: { flexDirection: "row", alignItems: "center", gap: tokens.space.md },
  cardEmoji: { fontSize: tokens.font.size.xl },
  cardTitleBlock: { flex: 1, gap: 2 },
  cardMeta: { flexDirection: "row", gap: tokens.space.sm, alignItems: "center" },
  fab: {
    position: "absolute",
    right: tokens.space.xl,
    bottom: tokens.space.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: tokens.accent.default,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { backgroundColor: tokens.accent.hover },
  fabGlyph: { fontSize: 28, fontWeight: tokens.font.weight.bold, lineHeight: 32 },
});
