import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ListSummary } from "@workshop/shared";
import {
  Button,
  EmptyState,
  type ListColorKey,
  Screen,
  ScreenHeader,
  Skeleton,
  tokens,
} from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { fetchItems } from "../../../../../src/api/items";
import { fetchListDetail, fetchListPreview, markListRead } from "../../../../../src/api/lists";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { goBack } from "../../../../../src/lib/goBack";
import { ListDetail, ListHeader } from "../../../../../src/screens/ListDetail";
import { ListPublicLanding } from "../../../../../src/screens/ListPublicLanding";
import { useJoinList } from "../../../../../src/screens/useJoinList";

/**
 * Thin route wrapper around `ListDetail`. Loads the list metadata + members
 * from `GET /v1/lists/:id` and hands them to the unified detail screen, which
 * handles all list types (album_shelf and otherwise) — see
 * `src/screens/ListDetail.tsx`.
 *
 * Three-way routing — the same `/list/:id` URL backs all of:
 *  - Signed-in member → full `ListDetail`.
 *  - Signed-in non-member or signed-out visitor → `ListPublicLanding`
 *    (driven by the public `/preview` endpoint, which 404s for
 *    archived/missing lists).
 *  - Both endpoints 404 → generic "couldn't load" state.
 *
 * We fire both queries unconditionally and pick which one to render based
 * on what came back. The preview query is cheap (one row + two counts) and
 * gives us a graceful fallback the instant the detail query 404s, instead
 * of flashing a generic error.
 */
function isAccessDenied(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

export default function ListDetailRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token, status: authStatus } = useAuth();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id ?? ""),
    queryFn: () => fetchListDetail(id ?? "", token),
    enabled: !!token && !!id,
    retry: (failureCount, error) => {
      if (isAccessDenied(error)) return false;
      return failureCount < 2;
    },
  });

  // The preview's `viewer` block depends on who is asking, so signed-in and
  // signed-out answers are cached apart; otherwise a preview cached before
  // sign-in keeps showing "Sign in to join" afterwards.
  const previewQuery = useQuery({
    queryKey: ["lists", "preview", id ?? "", token ? "viewer" : "anonymous"],
    queryFn: () => fetchListPreview(id ?? "", token),
    enabled: !!id,
  });

  // A signed-in non-member on a `join` list can join right here (0.4); the
  // route then re-renders as the member view once the detail refetches.
  const onJoin = useJoinList({
    preview: previewQuery.data?.preview,
    token,
    onJoined: () => {},
  });

  // Start the rows alongside the list's own request instead of after it, so
  // a cold load is one round trip deep, not two (2.13).
  useEffect(() => {
    if (!id || !token) return;
    queryClient
      .prefetchQuery({ queryKey: queryKeys.items.byList(id), queryFn: () => fetchItems(id, token) })
      .catch(() => {});
  }, [id, token, queryClient]);

  // What home already knows about this list paints the header at once.
  const summary =
    queryClient
      .getQueryData<{ lists: ListSummary[] }>(queryKeys.lists.all)
      ?.lists.find((l) => l.id === id) ?? null;

  // Mark this list as read whenever the route mounts (and re-mounts on
  // navigate-back via the stack). Decays the per-list unread badge on home.
  // Fire-and-forget — a failure here is invisible to the user, and a
  // non-member 404 from the read endpoint is expected.
  useEffect(() => {
    if (!id || !token) return;
    markListRead(id, token)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      })
      .catch(() => {});
  }, [id, token, queryClient]);

  if (!id) {
    return (
      <View style={styles.center}>
        <EmptyState title="Missing list id" />
      </View>
    );
  }

  const detailAvailable = !!token && !!listQuery.data;
  const detailDenied = !token || (listQuery.isError && isAccessDenied(listQuery.error));
  const stillLoading =
    (!!token && listQuery.isPending && !detailDenied) ||
    (authStatus === "loading" && previewQuery.isPending) ||
    (detailDenied && previewQuery.isPending);

  if (detailAvailable) {
    return (
      <ListDetail
        list={listQuery.data.list}
        members={listQuery.data.members}
        sources={listQuery.data.sources ?? []}
        token={token}
      />
    );
  }

  if (stillLoading) {
    return <ListDetailSkeleton summary={summary} />;
  }

  if (previewQuery.data) {
    return (
      <ListPublicLanding
        preview={previewQuery.data.preview}
        viewer={previewQuery.data.viewer}
        onJoin={onJoin}
      />
    );
  }

  return (
    <View style={styles.skeletonRoot}>
      <Screen>
        <ScreenHeader
          leading="back"
          onLeadingPress={() => goBack("/")}
          leadingTestID="list-detail-back"
        />
      </Screen>
      <View style={styles.center}>
        <EmptyState
          title="Couldn't load list"
          description={errorMessage(previewQuery.error ?? listQuery.error)}
          action={
            <Button
              label="Retry"
              variant="secondary"
              onPress={() => {
                previewQuery.refetch();
                if (token) listQuery.refetch();
              }}
            />
          }
        />
      </View>
    </View>
  );
}

/**
 * First-load placeholder in the shape of `ListDetail`. When home already
 * listed this list, its real header (name, badge, member count) paints at
 * once and only the rows are skeletons (2.13).
 */
function ListDetailSkeleton({ summary }: { summary: ListSummary | null }) {
  const accent =
    summary && (summary.color as ListColorKey) in tokens.list
      ? tokens.list[summary.color as ListColorKey]
      : tokens.accent.default;
  return (
    <View style={styles.skeletonRoot} testID="list-detail-loading">
      <Screen>
        {summary ? (
          <ListHeader
            list={summary}
            members={[]}
            accent={accent}
            subline={`${summary.memberCount} ${summary.memberCount === 1 ? "member" : "members"}`}
          />
        ) : (
          <>
            <ScreenHeader
              leading="back"
              onLeadingPress={() => goBack("/")}
              leadingTestID="list-detail-back"
            />
            <View style={styles.skeletonTitle}>
              <Skeleton.Block width={44} height={44} radius={tokens.radius.md} />
              <View style={styles.skeletonTitleText}>
                <Skeleton.Block width="70%" height={24} />
                <Skeleton.Block width="40%" height={12} />
              </View>
            </View>
          </>
        )}
        <View style={styles.skeletonToolbar}>
          <Skeleton.Block height={44} radius={tokens.radius.pill} />
        </View>
        <Skeleton.Rows count={7} badge={0} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRoot: { flex: 1, backgroundColor: tokens.bg.canvas },
  skeletonTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.lg,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  skeletonTitleText: { flex: 1, gap: tokens.space.sm },
  skeletonToolbar: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.md,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
