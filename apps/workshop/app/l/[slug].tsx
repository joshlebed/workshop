import { useQuery } from "@tanstack/react-query";
import { ApiError, errorMessage } from "@workshop/api-client/api";
import { Button, EmptyState, tokens } from "@workshop/ui";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { fetchListItemsBySlug, fetchListPreviewBySlug } from "../../src/api/share";
import { useAuth } from "../../src/hooks/useAuth";
import { ListPublicLanding } from "../../src/screens/ListPublicLanding";
import { useJoinList } from "../../src/screens/useJoinList";

/**
 * `/l/:slug` — canonical short share URL for a list.
 *
 * Three rendering paths:
 *  1. Viewer is a member → bounce to `/list/:id` so the address bar settles
 *     on the stable, UUID-shaped canonical URL (bookmark-friendly).
 *  2. Viewer is a non-member or signed-out → render `ListPublicLanding`,
 *     which picks its CTA (sign in / join / view-only) from
 *     `preview.shareVisibility` + the viewer state.
 *  3. Preview 404 (visibility=off or slug unknown) → "list not found"
 *     empty-state so we don't leak whether the slug ever existed.
 *
 * `joinListBySlug` is wired into the landing component as an injectable
 * action so it can show a loading state on the Join button.
 */
export default function ListShortLink() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { token } = useAuth();
  const router = useRouter();

  // Keyed by viewer kind: the `viewer` block differs before and after
  // sign-in, and a cached signed-out answer must not survive sign-in.
  const previewQuery = useQuery({
    queryKey: ["lists", "by-slug", slug ?? "", token ? "viewer" : "anonymous"],
    queryFn: () => fetchListPreviewBySlug(slug ?? "", token),
    enabled: !!slug,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });

  // Fetch the read-only items split only when the link is in `view` mode
  // AND the viewer isn't a member; members get a richer interactive page at
  // `/list/:id`. The hook is unconditionally registered (queryFn-gated)
  // because React rules-of-hooks doesn't allow conditional `useQuery`.
  const visibility = previewQuery.data?.preview.shareVisibility;
  const isMember = previewQuery.data?.viewer.isMember ?? false;
  const itemsQuery = useQuery({
    queryKey: ["lists", "by-slug-items", slug ?? ""],
    queryFn: () => fetchListItemsBySlug(slug ?? "", token),
    enabled: !!slug && !!previewQuery.data && visibility === "view" && !isMember,
  });

  // Join, then land in the list. `withAnchor` keeps home beneath it: this is a
  // root-stack route replacing into the `(lists)` stack (apps/workshop/CLAUDE.md).
  const onJoin = useJoinList({
    preview: previewQuery.data?.preview,
    token,
    onJoined: (res) => router.replace(`/list/${res.list.id}`, { withAnchor: true }),
  });

  if (!slug) {
    return (
      <View style={styles.center}>
        <EmptyState title="Missing share slug" />
      </View>
    );
  }

  if (previewQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (previewQuery.isError) {
    const notFound = previewQuery.error instanceof ApiError && previewQuery.error.status === 404;
    return (
      <View style={styles.center}>
        <EmptyState
          title={notFound ? "List not found" : "Couldn't load list"}
          description={
            notFound
              ? "The share link may have been reset or the list deleted."
              : errorMessage(previewQuery.error)
          }
          action={
            <Button label="Go home" variant="secondary" onPress={() => router.replace("/")} />
          }
        />
      </View>
    );
  }

  // Members: snap to the canonical `/list/:id` URL. The redirect happens
  // client-side so we keep the OG-render benefit of the slug URL when it
  // was the entry point.
  if (previewQuery.data.viewer.isMember) {
    return <Redirect href={`/list/${previewQuery.data.preview.id}`} />;
  }

  return (
    <ListPublicLanding
      preview={previewQuery.data.preview}
      viewer={previewQuery.data.viewer}
      shareSlug={slug}
      items={itemsQuery.data ?? null}
      joinPending={false}
      onJoin={onJoin}
    />
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
