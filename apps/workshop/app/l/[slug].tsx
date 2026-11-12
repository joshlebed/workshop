import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@workshop/api-client/api";
import { type Href, Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { fetchListPreviewBySlug } from "../../src/api/share";
import { useAuth } from "../../src/hooks/useAuth";
import { linkLoadError } from "../../src/lib/errorCopy";
import { LinkErrorScreen } from "../../src/screens/LinkErrorScreen";
import { ListPublicLanding, ListPublicLandingSkeleton } from "../../src/screens/ListPublicLanding";
import { useJoinList } from "../../src/screens/useJoinList";

/**
 * `/l/:slug`, the short share URL and the main way into a list.
 *
 *  1. Member → `/list/:id` (the bookmark-friendly canonical URL).
 *  2. Non-member or signed out → `ListPublicLanding`, which picks join /
 *     sign-in / read-only from the link's visibility.
 *  3. 404 (link off, reset, or list deleted) → a plain "doesn't open a list
 *     anymore" with a way home. A network failure gets Try again instead.
 */
export default function ListShortLink() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug;
  const { token } = useAuth();
  const router = useRouter();

  // Keyed by viewer kind: a cached signed-out answer must not survive sign-in.
  const previewQuery = useQuery({
    queryKey: ["lists", "by-slug", slug ?? "", token ? "viewer" : "anonymous"],
    queryFn: () => fetchListPreviewBySlug(slug ?? "", token),
    enabled: !!slug,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });

  // Join, then land in the list with home beneath it (root → `(lists)`).
  const onJoin = useJoinList({
    preview: previewQuery.data?.preview,
    token,
    onJoined: (res) => router.replace(`/list/${res.list.id}` as Href, { withAnchor: true }),
  });

  if (!slug) {
    return (
      <LinkErrorScreen
        title="This link is incomplete"
        message="It's missing the part that names the list. Ask whoever sent it to share it again."
      />
    );
  }

  if (previewQuery.isPending) return <ListPublicLandingSkeleton />;

  if (previewQuery.isError) {
    const copy = linkLoadError(previewQuery.error);
    return (
      <LinkErrorScreen
        title={copy.title}
        message={copy.message}
        onRetry={copy.notFound ? undefined : () => void previewQuery.refetch()}
        retrying={previewQuery.isFetching}
        testID="list-landing-error"
      />
    );
  }

  if (previewQuery.data.viewer.isMember) {
    return <Redirect href={`/list/${previewQuery.data.preview.id}`} />;
  }

  return (
    <ListPublicLanding
      preview={previewQuery.data.preview}
      viewer={previewQuery.data.viewer}
      returnPath={`/l/${slug}`}
      onJoin={onJoin}
    />
  );
}
