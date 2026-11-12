import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ListSummary } from "@workshop/shared";
import {
  type ListColorKey,
  layout,
  Reveal,
  Screen,
  ScreenHeader,
  Skeleton,
  screenColumnStyle,
  tokens,
  useRevealAfterLoading,
} from "@workshop/ui";
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { fetchItems } from "../../../../../src/api/items";
import { fetchListDetail, fetchListPreview, markListRead } from "../../../../../src/api/lists";
import { useAuth } from "../../../../../src/hooks/useAuth";
import { linkLoadError } from "../../../../../src/lib/errorCopy";
import { goBack } from "../../../../../src/lib/goBack";
import { LinkErrorScreen } from "../../../../../src/screens/LinkErrorScreen";
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

  const detailAvailable = !!token && !!listQuery.data;
  const detailDenied = !token || (listQuery.isError && isAccessDenied(listQuery.error));
  const stillLoading =
    (!!token && listQuery.isPending && !detailDenied) ||
    (authStatus === "loading" && previewQuery.isPending) ||
    (detailDenied && previewQuery.isPending);
  // The list fades in over its skeleton; a list home already had paints at once.
  const revealed = useRevealAfterLoading(stillLoading);

  if (!id) {
    return (
      <LinkErrorScreen
        title="This link is incomplete"
        message="It's missing the part that names the list. Pick one from your lists."
      />
    );
  }

  if (detailAvailable) {
    return (
      <Reveal when={revealed}>
        <ListDetail
          list={listQuery.data.list}
          members={listQuery.data.members}
          sources={listQuery.data.sources ?? []}
          token={token}
        />
      </Reveal>
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
        returnPath={`/list/${id}`}
        onJoin={onJoin}
      />
    );
  }

  const copy = linkLoadError(previewQuery.error ?? listQuery.error);
  return (
    <LinkErrorScreen
      title={copy.title}
      message={copy.message}
      onRetry={
        copy.notFound
          ? undefined
          : () => {
              void previewQuery.refetch();
              if (token) void listQuery.refetch();
            }
      }
      retrying={previewQuery.isFetching}
      testID="list-error"
    />
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
            subline={summary.memberCount > 1 ? `${summary.memberCount} members` : ""}
          />
        ) : (
          <>
            <ScreenHeader
              leading="back"
              onLeadingPress={() => goBack("/")}
              leadingTestID="list-detail-back"
            />
            <View style={[styles.skeletonTitle, screenColumnStyle]}>
              <Skeleton.Block width={44} height={44} radius={tokens.radius.md} />
              <View style={styles.skeletonTitleText}>
                <Skeleton.Block width="70%" height={24} />
                <Skeleton.Block width="40%" height={12} />
              </View>
            </View>
          </>
        )}
        <View style={[styles.skeletonToolbar, screenColumnStyle]}>
          <Skeleton.Block height={44} radius={tokens.radius.pill} />
        </View>
        <View style={screenColumnStyle}>
          <Skeleton.Rows count={7} badge={0} />
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRoot: { flex: 1, backgroundColor: tokens.bg.canvas },
  skeletonTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.sm,
  },
  skeletonTitleText: { flex: 1, gap: tokens.space.sm },
  skeletonToolbar: {
    paddingHorizontal: layout.gutter,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.md,
  },
});
