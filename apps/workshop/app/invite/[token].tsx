import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workshop/api-client/api";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { removeItem, setItem } from "@workshop/api-client/storage";
import { useToast } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { acceptInvite, fetchInvitePreview } from "../../src/api/invites";
import { useAuth } from "../../src/hooks/useAuth";
import { joinErrorMessage, linkLoadError } from "../../src/lib/errorCopy";
import { PENDING_INVITE_TOKEN_KEY } from "../../src/lib/inviteStash";
import { LinkErrorScreen } from "../../src/screens/LinkErrorScreen";
import { ListPublicLanding, ListPublicLandingSkeleton } from "../../src/screens/ListPublicLanding";

/**
 * `/invite/:token`, the legacy share URL still sitting in old threads (4.6).
 * It shows the same list preview as `/l/:slug` and joins only when asked;
 * it used to join on mount.
 *
 * The token is stashed for a sign-in round trip (and for signup
 * attribution). The stash is cleared when the join succeeds, when the server
 * says the link is gone, or once a signed-in viewer has the preview in front
 * of them (the URL itself carries the token from then on). A network failure
 * keeps it and offers Try again.
 */
export default function InviteLanding() {
  const params = useLocalSearchParams<{ token?: string }>();
  const inviteToken = (Array.isArray(params.token) ? params.token[0] : params.token)?.trim() ?? "";
  const { status, token } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const authenticated = status === "signed-in";

  const previewQuery = useQuery({
    queryKey: ["invites", "preview", inviteToken],
    queryFn: () => fetchInvitePreview(inviteToken),
    enabled: inviteToken.length > 0,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });

  const notFound = previewQuery.error instanceof ApiError && previewQuery.error.status === 404;
  useEffect(() => {
    if (!inviteToken) return;
    if (notFound || (authenticated && previewQuery.data)) {
      void removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
    }
  }, [inviteToken, notFound, authenticated, previewQuery.data]);

  if (!inviteToken) {
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
        testID="invite-error"
      />
    );
  }

  const onJoin = async () => {
    try {
      const res = await acceptInvite(inviteToken, token);
      await removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all });
      router.replace(`/list/${res.list.id}` as Href, { withAnchor: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        await removeItem(PENDING_INVITE_TOKEN_KEY).catch(() => {});
        void previewQuery.refetch();
      }
      showToast({ message: joinErrorMessage(e), tone: "danger" });
    }
  };

  return (
    <ListPublicLanding
      // An invite token joins whatever the list's own link setting is.
      preview={{ ...previewQuery.data.preview, shareVisibility: "join" }}
      viewer={{ authenticated, isMember: false }}
      returnPath={`/invite/${inviteToken}`}
      onJoin={authenticated ? onJoin : null}
      onBeforeSignIn={() => setItem(PENDING_INVITE_TOKEN_KEY, inviteToken).catch(() => {})}
    />
  );
}
