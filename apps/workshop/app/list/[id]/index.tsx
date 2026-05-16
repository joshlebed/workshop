import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { fetchListDetail, markListRead } from "../../../src/api/lists";
import { useAuth } from "../../../src/hooks/useAuth";
import { errorMessage } from "../../../src/lib/api";
import { queryKeys } from "../../../src/lib/queryKeys";
import { ListDetail } from "../../../src/screens/ListDetail";
import { Button, EmptyState, tokens } from "../../../src/ui/index";

/**
 * Thin route wrapper around `ListDetail`. Loads the list metadata + members
 * from `GET /v1/lists/:id` and hands them to the unified detail screen, which
 * handles all list types (album_shelf and otherwise) — see
 * `src/screens/ListDetail.tsx`.
 */
export default function ListDetailRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { token } = useAuth();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: queryKeys.lists.detail(id ?? ""),
    queryFn: () => fetchListDetail(id ?? "", token),
    enabled: !!token && !!id,
  });

  // Mark this list as read whenever the route mounts (and re-mounts on
  // navigate-back via the stack). Decays the per-list unread badge on home.
  // Fire-and-forget — a failure here is invisible to the user.
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

  if (listQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (listQuery.isError || !listQuery.data) {
    return (
      <View style={styles.center}>
        <EmptyState
          title="Couldn't load list"
          description={errorMessage(listQuery.error)}
          action={<Button label="Retry" variant="secondary" onPress={() => listQuery.refetch()} />}
        />
      </View>
    );
  }

  return <ListDetail list={listQuery.data.list} members={listQuery.data.members} token={token} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.bg.canvas,
  },
});
