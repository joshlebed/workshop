import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { fetchListDetail, fetchListPreview, markListRead } from "../../../src/api/lists";
import { useAuth } from "../../../src/hooks/useAuth";
import { ApiError, errorMessage } from "../../../src/lib/api";
import { queryKeys } from "../../../src/lib/queryKeys";
import { ListDetail } from "../../../src/screens/ListDetail";
import { ListPublicLanding } from "../../../src/screens/ListPublicLanding";
import { Button, EmptyState, tokens } from "../../../src/ui/index";

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

  const previewQuery = useQuery({
    queryKey: ["lists", "preview", id ?? ""],
    queryFn: () => fetchListPreview(id ?? "", token),
    enabled: !!id,
  });

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
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (previewQuery.data) {
    return (
      <ListPublicLanding preview={previewQuery.data.preview} viewer={previewQuery.data.viewer} />
    );
  }

  return (
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
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
  },
});
