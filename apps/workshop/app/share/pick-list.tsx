import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ItemKind, ListSummary } from "@workshop/shared";
import { Button, EmptyState, type ListColorKey, Screen, Text, tokens } from "@workshop/ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { fetchLists } from "../../src/api/lists";
import { PullToRefresh } from "../../src/components/PullToRefresh";
import { useAuth } from "../../src/hooks/useAuth";

const KIND_LABEL: Partial<Record<ItemKind, string>> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  link: "Links",
  spotify_album: "Album shelf",
  plain: "List",
};

function summaryLabel(list: ListSummary): string {
  if (list.itemKind && KIND_LABEL[list.itemKind]) return KIND_LABEL[list.itemKind]!;
  return "List";
}

// Lists that pair naturally with a shared URL — anything that accepts the
// `link` content shape (date ideas, trips, daily games).
function isUrlFriendly(list: ListSummary): boolean {
  return list.itemKind === "link" || list.itemKind === null;
}

function shortHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default function PickList() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const sharedUrl = firstParam(params.url);
  const sharedText =
    firstParam(params.text) ?? (sharedUrl && !isLikelyUrl(sharedUrl) ? sharedUrl : null);
  const normalizedSharedUrl = sharedUrl && isLikelyUrl(sharedUrl) ? sharedUrl : null;
  const router = useRouter();
  const { token } = useAuth();

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });

  // Sort by recency (updatedAt) so the list the user just touched lands at
  // the top — matches home's behaviour and removes a hunt-for-the-list step.
  const lists = useMemo(() => {
    const data = listsQuery.data?.lists ?? [];
    return [...data].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [listsQuery.data]);

  const onPick = (list: ListSummary) => {
    const search = new URLSearchParams();
    if (normalizedSharedUrl) search.set("prefillUrl", normalizedSharedUrl);
    if (!normalizedSharedUrl && sharedText) search.set("prefillText", sharedText);
    const qs = search.toString();
    const target = qs ? (`/list/${list.id}/add?${qs}` as const) : (`/list/${list.id}/add` as const);
    router.replace(target, { withAnchor: true });
  };

  const onCreateNew = () => {
    router.replace("/create-list/type", { withAnchor: true });
  };

  const onCancel = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  const host = shortHost(normalizedSharedUrl);

  return (
    <Screen style={styles.root}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={onCancel}
          testID="share-pick-cancel"
          hitSlop={10}
          style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
        >
          <Text style={styles.navGlyph}>✕</Text>
        </Pressable>
        <View style={styles.headerTitleBlock}>
          <Text variant="title" style={styles.title}>
            Add to a list
          </Text>
          {normalizedSharedUrl || sharedText ? (
            <View style={styles.urlPill} testID="share-pick-url">
              <View style={styles.urlGlobe} />
              <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.urlText}>
                {normalizedSharedUrl ? `Saving from ${host ?? normalizedSharedUrl}` : "Shared text"}
              </Text>
            </View>
          ) : null}
        </View>
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
        ) : lists.length === 0 ? (
          <View style={styles.center}>
            <EmptyState
              title="No lists yet"
              description={
                normalizedSharedUrl || sharedText
                  ? "Create your first list to save this."
                  : "Create your first list to start collecting."
              }
              action={<Button label="Create a list" onPress={onCreateNew} />}
            />
          </View>
        ) : (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <FlatList
              testID="share-pick-list"
              data={lists}
              keyExtractor={(l) => l.id}
              contentContainerStyle={styles.listContent}
              ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
              renderItem={({ item }) => (
                <ListRow
                  list={item}
                  hasSharedUrl={!!normalizedSharedUrl}
                  onPress={() => onPick(item)}
                />
              )}
              ListFooterComponent={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Create new list"
                  onPress={onCreateNew}
                  testID="share-pick-create-new"
                  style={({ pressed }) => [styles.createRow, pressed && styles.createRowPressed]}
                >
                  <View style={styles.createGlyphBadge}>
                    <Text style={styles.createGlyph}>+</Text>
                  </View>
                  <Text variant="label" style={styles.createLabel}>
                    Create new list
                  </Text>
                </Pressable>
              }
            />
          </PullToRefresh>
        )}
      </View>
    </Screen>
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function isLikelyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function ListRow({
  list,
  hasSharedUrl,
  onPress,
}: {
  list: ListSummary;
  hasSharedUrl: boolean;
  onPress: () => void;
}) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const itemsLabel =
    list.itemCount === 0 ? "Empty" : `${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`;
  const subtitle =
    list.memberCount > 1
      ? `${summaryLabel(list)} · ${list.memberCount} members`
      : `${summaryLabel(list)} · ${itemsLabel}`;
  // When the user is mid-share with a URL attached, lists that don't take
  // free-form items (movie/tv/book go through search) are dimmed so the eye
  // skips them. The row is still tappable — the add screen will handle it.
  const dim = hasSharedUrl && !isUrlFriendly(list);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add to ${list.name}`}
      onPress={onPress}
      testID={`share-pick-row-${list.id}`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, dim && styles.rowDim]}
    >
      <View style={[styles.avatar, { backgroundColor: `${accent}1F` }]}>
        <Text style={styles.avatarEmoji}>{list.emoji}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text variant="label" numberOfLines={1} style={styles.rowTitle}>
          {list.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.xs,
    paddingHorizontal: tokens.space.sm,
    paddingRight: tokens.space.lg,
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
  navGlyph: { color: tokens.text.primary, fontSize: tokens.font.size.lg },
  headerTitleBlock: { flex: 1, minWidth: 0, gap: tokens.space.xs, paddingTop: 4 },
  title: { fontSize: tokens.font.size.xl, letterSpacing: -0.3 },
  urlPill: {
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
  urlGlobe: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.accent.default,
  },
  urlText: { letterSpacing: 0.1, flexShrink: 1 },
  body: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: tokens.space.xxl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
  },
  rowPressed: { backgroundColor: tokens.bg.surface },
  rowDim: { opacity: 0.55 },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginLeft: tokens.space.lg + 44 + tokens.space.md,
  },
  rowBody: { flex: 1, gap: 2, minWidth: 0 },
  rowTitle: { fontSize: tokens.font.size.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarEmoji: { fontSize: 22, lineHeight: 26 },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md,
    marginTop: tokens.space.sm,
  },
  createRowPressed: { backgroundColor: tokens.bg.surface },
  createGlyphBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: tokens.border.default,
    borderStyle: "dashed",
  },
  createGlyph: {
    fontSize: tokens.font.size.lg,
    color: tokens.text.secondary,
    fontWeight: tokens.font.weight.semibold,
    lineHeight: tokens.font.size.lg + 2,
  },
  createLabel: { fontSize: tokens.font.size.md, color: tokens.text.secondary },
});
