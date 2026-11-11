import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ItemKind, ListSummary } from "@workshop/shared";
import {
  Button,
  EmojiBadge,
  EmptyState,
  Icon,
  type ListColorKey,
  ListRow,
  PullToRefresh,
  Screen,
  ScreenHeader,
  Skeleton,
  Text,
  tokens,
} from "@workshop/ui";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { fetchActivity } from "../../src/api/activity";
import { fetchLists } from "../../src/api/lists";
import { useAuth } from "../../src/hooks/useAuth";
import { homeListOrder } from "../../src/lib/homeListOrder";

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

  // Same lists in the same order as home (0.17): hidden lists are left out,
  // pinned first, then latest activity. The activity feed is usually warm
  // from home; without it the order falls back to `updatedAt`.
  const activityQuery = useQuery({
    queryKey: queryKeys.activity.feed,
    queryFn: () => fetchActivity({ limit: 50 }, token),
    enabled: !!token,
    staleTime: 30_000,
  });
  const lists = useMemo(() => {
    const latest = new Map<string, string>();
    for (const e of activityQuery.data?.events ?? []) {
      if (!latest.has(e.listId)) latest.set(e.listId, e.createdAt);
    }
    return homeListOrder(listsQuery.data?.lists ?? [], (id) => latest.get(id));
  }, [listsQuery.data, activityQuery.data]);

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
      <ScreenHeader
        leading="close"
        leadingLabel="Cancel"
        leadingTestID="share-pick-cancel"
        onLeadingPress={onCancel}
        title="Add to a list"
      />
      {normalizedSharedUrl || sharedText ? (
        <View style={styles.urlPill} testID="share-pick-url">
          <View style={styles.urlGlobe} />
          <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.urlText}>
            {normalizedSharedUrl ? `Saving from ${host ?? normalizedSharedUrl}` : "Shared text"}
          </Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {listsQuery.isPending ? (
          <Skeleton.Rows count={6} testID="share-pick-loading" />
        ) : listsQuery.isError && !listsQuery.data ? (
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
                <PickRow
                  list={item}
                  hasSharedUrl={!!normalizedSharedUrl}
                  onPress={() => onPick(item)}
                />
              )}
              ListFooterComponent={
                <ListRow
                  title={
                    <Text tone="secondary" style={styles.createLabel}>
                      Create new list
                    </Text>
                  }
                  leading={
                    <View style={styles.createGlyphBadge}>
                      <Icon name="plus" size={18} tone="secondary" />
                    </View>
                  }
                  accessibilityLabel="Create new list"
                  onPress={onCreateNew}
                  testID="share-pick-create-new"
                  style={styles.createRow}
                />
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

function PickRow({
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
    <ListRow
      title={list.name}
      subtitle={subtitle}
      leading={<EmojiBadge emoji={list.emoji} color={accent} />}
      accessibilityLabel={`Add to ${list.name}`}
      onPress={onPress}
      testID={`share-pick-row-${list.id}`}
      style={dim ? styles.rowDim : undefined}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    paddingTop: tokens.space.lg,
    paddingBottom: tokens.space.lg,
    gap: tokens.space.md,
  },
  urlPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.xsm,
    marginHorizontal: tokens.space.lg,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
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
  listContent: { paddingTop: tokens.space.xs, paddingBottom: tokens.space.xxl },
  rowDim: { opacity: 0.55 },
  rowSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: tokens.border.subtle,
    marginLeft: tokens.space.lg + 44 + tokens.space.md,
  },
  createRow: { marginTop: tokens.space.sm },
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
  createLabel: { fontWeight: tokens.font.weight.medium },
});
