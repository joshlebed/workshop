import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ItemKind, LinkPreview, ListSummary } from "@workshop/shared";
import {
  Badge,
  Button,
  EmojiBadge,
  EmptyState,
  haptics,
  Icon,
  type ListColorKey,
  ListRow,
  PullToRefresh,
  Screen,
  ScreenHeader,
  Skeleton,
  Text,
  tokens,
  useToast,
} from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, View } from "react-native";
import { fetchActivity } from "../../src/api/activity";
import { createItem } from "../../src/api/items";
import { fetchLinkPreview } from "../../src/api/linkPreview";
import { fetchLists } from "../../src/api/lists";
import { useAuth } from "../../src/hooks/useAuth";
import { addSurfaceHref } from "../../src/lib/createFromTemplate";
import { shareSaveErrorMessage } from "../../src/lib/errorCopy";
import { homeListOrder } from "../../src/lib/homeListOrder";
import { noteItemAdded } from "../../src/lib/recentlyAdded";
import {
  canQuickSave,
  normalizeSharePayload,
  readLastShareListId,
  rememberShareList,
  type SharePayload,
  shareAddParams,
  shareCaption,
  sharedItemRequest,
  sharePayloadParams,
  sharePickOrder,
  stashPendingShare,
} from "../../src/lib/sharePayload";

/** How long a save waits for a link's preview before saving without it. */
const PREVIEW_WAIT_MS = 2500;

const KIND_LABEL: Partial<Record<ItemKind, string>> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  link: "Links",
  spotify_album: "Album shelf",
  plain: "List",
};

/**
 * The share extension's list picker (UX pass 4.4). Lists in home order with
 * the last one a share went into on top, marked. On a list that takes a free
 * line or a link, one tap saves the share and lands on the list with the new
 * row highlighted and "Added to …"; search-backed lists open their add
 * surface prefilled. "New list" carries the share through creation. A failed
 * save keeps everything here and offers Retry.
 */
export default function PickList() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const payload = useMemo(
    () => normalizeSharePayload({ url: firstParam(params.url), text: firstParam(params.text) }),
    [params.url, params.text],
  );
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { token, status } = useAuth();

  // Signed out (a link straight here): keep the share through sign-in.
  useEffect(() => {
    if (status !== "signed-out") return;
    (async () => {
      if (payload) await stashPendingShare(payload);
      router.replace("/sign-in");
    })();
  }, [status, payload, router]);

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });
  // Same order as home (0.17): hidden lists left out, pinned first, then
  // latest activity. The feed is usually warm from home.
  const activityQuery = useQuery({
    queryKey: queryKeys.activity.feed,
    queryFn: () => fetchActivity({ limit: 50 }, token),
    enabled: !!token,
    staleTime: 30_000,
  });
  const [lastListId, setLastListId] = useState<string | null>(null);
  useEffect(() => {
    void readLastShareListId().then(setLastListId);
  }, []);
  const lists = useMemo(() => {
    const latest = new Map<string, string>();
    for (const e of activityQuery.data?.events ?? []) {
      if (!latest.has(e.listId)) latest.set(e.listId, e.createdAt);
    }
    const ordered = homeListOrder(listsQuery.data?.lists ?? [], (id) => latest.get(id));
    return sharePickOrder(ordered, lastListId);
  }, [listsQuery.data, activityQuery.data, lastListId]);
  const lastUsedId = lists[0]?.id === lastListId ? lastListId : null;

  const [savingId, setSavingId] = useState<string | null>(null);

  const quickSave = async (list: ListSummary, share: SharePayload) => {
    setSavingId(list.id);
    try {
      let preview: LinkPreview | null = null;
      if (share.url) {
        const url = share.url;
        preview = await Promise.race([
          queryClient
            .fetchQuery({
              queryKey: ["link-preview", url],
              queryFn: ({ signal }) => fetchLinkPreview(url, token, signal),
              staleTime: 5 * 60_000,
            })
            .then((r) => r.preview)
            .catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), PREVIEW_WAIT_MS)),
        ]);
      }
      const { item } = await createItem(
        list.id,
        sharedItemRequest(share, list.itemKind, preview),
        token,
      );
      haptics.success();
      noteItemAdded(list.id, item.id);
      void rememberShareList(list.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.items.byList(list.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      showToast({ key: "share-saved", message: `Added to ${list.name}` });
      // Root stack → `(lists)`: `withAnchor` keeps home beneath the list.
      router.replace(`/list/${list.id}` as Href, { withAnchor: true });
    } catch (e) {
      setSavingId(null);
      showToast({
        key: "share-saved",
        message: shareSaveErrorMessage(list.name, e),
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => void quickSave(list, share),
      });
    }
  };

  const onPick = (list: ListSummary) => {
    if (savingId) return;
    if (payload && canQuickSave(list.itemKind)) {
      void quickSave(list, payload);
      return;
    }
    // Search-backed lists (and no payload at all): the add surface, prefilled.
    if (payload) void rememberShareList(list.id);
    const href = addSurfaceHref(list.id, payload ? shareAddParams(payload) : {});
    router.replace(href as Href, { withAnchor: true });
  };

  const onCreateNew = () => {
    const qs = payload ? new URLSearchParams(sharePayloadParams(payload)).toString() : "";
    router.replace((qs ? `/create-list/type?${qs}` : "/create-list/type") as Href, {
      withAnchor: true,
    });
  };

  const onCancel = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const newListRow = (
    <ListRow
      title="New list"
      subtitle={payload ? "Make a list and add this to it" : undefined}
      leading={
        <View style={styles.createGlyphBadge}>
          <Icon name="plus" size={18} tone="secondary" />
        </View>
      }
      onPress={onCreateNew}
      disabled={!!savingId}
      testID="share-pick-create-new"
      style={styles.createRow}
    />
  );

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="close"
        leadingLabel="Cancel"
        leadingTestID="share-pick-cancel"
        onLeadingPress={onCancel}
        title="Add to a list"
      />
      {payload ? (
        <View style={styles.urlPill} testID="share-pick-url">
          <View style={styles.urlDot} />
          <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.urlText}>
            {shareCaption(payload)}
          </Text>
        </View>
      ) : null}

      <View style={styles.body}>
        {listsQuery.isPending ? (
          <Skeleton.Rows count={6} testID="share-pick-loading" />
        ) : listsQuery.isError && !listsQuery.data ? (
          <PullToRefresh
            refreshing={listsQuery.isRefetching}
            onRefresh={() => listsQuery.refetch()}
          >
            <ScrollView contentContainerStyle={styles.center}>
              <EmptyState
                title="Couldn't load your lists"
                description="Check your connection and try again. What you shared is still here."
                action={
                  <Button label="Retry" variant="secondary" onPress={() => listsQuery.refetch()} />
                }
              />
            </ScrollView>
          </PullToRefresh>
        ) : lists.length === 0 ? (
          <ScrollView contentContainerStyle={styles.listContent}>
            <Text tone="secondary" style={styles.emptyLead}>
              {payload
                ? "You don't have a list yet. Make one for this."
                : "You don't have a list yet."}
            </Text>
            {newListRow}
          </ScrollView>
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
                  lastUsed={item.id === lastUsedId}
                  saving={savingId === item.id}
                  disabled={!!savingId && savingId !== item.id}
                  onPress={() => onPick(item)}
                />
              )}
              ListFooterComponent={newListRow}
            />
          </PullToRefresh>
        )}
      </View>
    </Screen>
  );
}

function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

function PickRow({
  list,
  lastUsed,
  saving,
  disabled,
  onPress,
}: {
  list: ListSummary;
  lastUsed: boolean;
  saving: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const accent = tokens.list[list.color as ListColorKey] ?? tokens.accent.default;
  const kind = (list.itemKind && KIND_LABEL[list.itemKind]) || "List";
  const count =
    list.itemCount === 0 ? "Empty" : `${list.itemCount} ${list.itemCount === 1 ? "item" : "items"}`;
  const subtitle =
    list.memberCount > 1 ? `${kind} · ${list.memberCount} members` : `${kind} · ${count}`;
  return (
    <ListRow
      title={list.name}
      subtitle={subtitle}
      leading={<EmojiBadge emoji={list.emoji} color={accent} />}
      trailing={
        saving ? (
          <ActivityIndicator color={tokens.text.muted} />
        ) : lastUsed ? (
          <Badge label="Last used" tone="neutral" testID="share-pick-last-used" />
        ) : null
      }
      accessibilityLabel={`Add to ${list.name}${lastUsed ? ", last used" : ""}`}
      onPress={onPress}
      disabled={disabled}
      testID={`share-pick-row-${list.id}`}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
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
  urlDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.accent.default },
  urlText: { letterSpacing: 0.1, flexShrink: 1 },
  body: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingTop: tokens.space.xs, paddingBottom: tokens.space.xxl },
  emptyLead: { paddingHorizontal: tokens.space.lg, paddingBottom: tokens.space.sm },
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
});
