import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import type { ListListResponse } from "@workshop/shared";
import {
  Button,
  EmojiBadge,
  EmptyState,
  type ListColorKey,
  ListRow,
  Screen,
  ScreenHeader,
  Skeleton,
  Text,
  tokens,
  useToast,
} from "@workshop/ui";
import { FlatList, StyleSheet, View } from "react-native";
import { fetchLists, unarchiveList } from "../../../../src/api/lists";
import { useAuth } from "../../../../src/hooks/useAuth";
import { goBack } from "../../../../src/lib/goBack";
import { homeRowCount } from "../../../../src/screens/home/homeRow";

/** Settings → Hidden lists (3.5): lists hidden from home, each with Unhide. */
export default function HiddenLists() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const listsQuery = useQuery({
    queryKey: queryKeys.lists.all,
    queryFn: () => fetchLists(token),
    enabled: !!token,
  });
  const hidden = (listsQuery.data?.lists ?? [])
    .filter((l) => !!l.archivedAt)
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));

  // Optimistic: the row leaves at once and comes back with a toast on failure.
  const unhide = useMutation<
    { ok: true },
    Error,
    { id: string; name: string },
    { previous?: ListListResponse }
  >({
    mutationFn: ({ id }) => unarchiveList(id, token),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.lists.all });
      const previous = queryClient.getQueryData<ListListResponse>(queryKeys.lists.all);
      if (previous) {
        queryClient.setQueryData<ListListResponse>(queryKeys.lists.all, {
          lists: previous.lists.map((l) => (l.id === id ? { ...l, archivedAt: null } : l)),
        });
      }
      return { previous };
    },
    onSuccess: (_r, { name }) => showToast({ message: `“${name}” is back on home` }),
    onError: (e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKeys.lists.all, ctx.previous);
      showToast({ message: errorMessage(e, "Couldn't unhide that list."), tone: "danger" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }),
  });

  return (
    <Screen style={styles.root}>
      <ScreenHeader
        leading="back"
        onLeadingPress={() => goBack("/settings")}
        leadingTestID="hidden-lists-back"
        title="Hidden lists"
      />
      {listsQuery.isPending ? (
        <Skeleton.Rows count={3} />
      ) : hidden.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            title="Nothing hidden"
            description="Hide a list from its menu on home. It stays here until you bring it back."
          />
        </View>
      ) : (
        <FlatList
          data={hidden}
          keyExtractor={(l) => l.id}
          ListHeaderComponent={
            <Text variant="caption" tone="muted" style={styles.intro}>
              Only you stop seeing these. Everyone else still has them.
            </Text>
          }
          renderItem={({ item }) => (
            <ListRow
              leading={
                <EmojiBadge
                  emoji={item.emoji}
                  color={tokens.list[item.color as ListColorKey] ?? tokens.accent.default}
                  imageUrl={item.coverPhotoUrl}
                />
              }
              title={item.name}
              subtitle={homeRowCount(item)}
              trailing={
                <Button
                  label="Unhide"
                  variant="secondary"
                  onPress={() => unhide.mutate({ id: item.id, name: item.name })}
                  testID={`hidden-unhide-${item.id}`}
                />
              }
              testID={`hidden-list-${item.id}`}
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bg.canvas },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
  },
  intro: {
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.sm,
  },
});
