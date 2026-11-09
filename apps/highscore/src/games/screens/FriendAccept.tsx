import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { acceptFriendRequest, fetchFriendRequestPreview } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { removeItem, setItem } from "@workshop/api-client/storage";
import { haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Avatar, Button, Card, Text, tokens } from "../../theme";
import { OpenInAppCard } from "../components/OpenInAppCard";
import { useInAppBrowserPrompt } from "../hooks/useInAppBrowserPrompt";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { PENDING_FRIEND_INVITE_TOKEN_KEY } from "../lib/inviteStash";
import { useGamesRuntime } from "../runtime";
import { Centered, PostAcceptPicker, styles } from "./friendAccept/PostAcceptPicker";

/**
 * Deep-link landing for a friend invite (`/friends/accept/:token`, minted by
 * `POST /v1/friends/invite`). Mirrors the list invite round-trip
 * (`onboarding/accept-invite.tsx` + `inviteStash`) so a brand-new user can
 * sign in mid-flow and land back here.
 *
 * Unlike the list invite — which auto-accepts on mount — a friend invite
 * previews the inviter and waits for an explicit **Accept** (spec §3.4): you
 * see who's adding you before the edge forms.
 *
 * Flow:
 *   1. Stash the token so a sign-in round-trip recovers it.
 *   2. Signed-out → AuthGate routes to `/sign-in`; the stash bounces the user
 *      back here once signed in.
 *   3. Signed-in → preview the inviter, then on Accept POST the acceptance,
 *      clear the stash, refresh the friend + games caches, and show the
 *      post-accept picker of the new friend's games (G3) — so a brand-new user
 *      leaves onboarding with a populated home.
 */
export default function AcceptFriendInvite() {
  const params = useLocalSearchParams<{ token?: string }>();
  const inviteToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken, user, routes, appName, appScheme } = useGamesRuntime();
  const { showAppPrompt, continueOnWeb } = useInAppBrowserPrompt(
    inviteToken ? `/friends/accept/${encodeURIComponent(inviteToken)}` : null,
  );
  const router = useRouter();
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [acceptedFriend, setAcceptedFriend] = useState<{
    userId: string;
    displayName: string | null;
  } | null>(null);

  // Stash on mount so a redirect through /sign-in can recover the token. Gated
  // on the flag so a stale link can never strand a prod (flag-off) user.
  useEffect(() => {
    if (!inviteToken) return;
    setItem(PENDING_FRIEND_INVITE_TOKEN_KEY, inviteToken).catch(() => {});
  }, [inviteToken]);

  // Signed-out → send through sign-in. AuthGate bounces back here once signed
  // in (it consults the friend stash, same as the list-invite stash).
  useEffect(() => {
    if (!showAppPrompt && status === "signed-out" && inviteToken) {
      router.replace(routes.signIn as Href);
    }
  }, [status, inviteToken, router, routes.signIn, showAppPrompt]);

  const previewQuery = useQuery({
    queryKey: queryKeys.friends.requestPreview(inviteToken ?? ""),
    queryFn: () => fetchFriendRequestPreview(inviteToken ?? "", authToken),
    enabled: !!inviteToken && status === "signed-in" && !acceptedFriend && !showAppPrompt,
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptFriendRequest(inviteToken ?? "", authToken),
    onSuccess: async (data) => {
      haptics.medium();
      await removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        // Friendship gates score visibility — refresh the social board.
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
      // Hand off to the post-accept picker instead of bouncing to /friends.
      setAcceptedFriend(data.friend);
    },
    onError: (e) => {
      // Drop the stash on a hard failure so re-opening doesn't loop back here.
      removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
      setError(errorMessage(e, "Couldn't accept the invite"));
    },
  });

  if (showAppPrompt) {
    return (
      <Centered testID="friend-accept-open-in-app">
        <OpenInAppCard
          appName={appName}
          url={`${appScheme}:///friends/accept/${encodeURIComponent(inviteToken ?? "")}`}
          onContinue={continueOnWeb}
        />
      </Centered>
    );
  }

  if (!inviteToken) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Invite link missing token</Text>
          <Text tone="secondary">Ask your friend to send you a fresh invite link.</Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  if (error) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Couldn't add friend</Text>
          <Text tone="secondary" testID="friend-accept-error">
            {error}
          </Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  // Still resolving auth, or signed-out and on the way to /sign-in.
  if (status !== "signed-in") {
    return (
      <Centered testID="friend-accept-loading">
        <ActivityIndicator color={tokens.accent.default} />
        <Text tone="secondary" style={styles.loadingText}>
          Sign in to add your friend
        </Text>
      </Centered>
    );
  }

  // Accepted — pick which of the new friend's games to add (skippable).
  if (acceptedFriend) {
    return (
      <PostAcceptPicker
        friend={acceptedFriend}
        token={authToken}
        onDone={() => router.replace(routes.home as Href)}
      />
    );
  }

  if (previewQuery.isPending) {
    return (
      <Centered testID="friend-accept-loading">
        <ActivityIndicator color={tokens.accent.default} />
      </Centered>
    );
  }

  if (previewQuery.isError) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Invite not found</Text>
          <Text tone="secondary">This invite link isn't valid anymore.</Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  const preview = previewQuery.data;
  const inviterName = preview.inviter.displayName?.trim() || "Someone";
  const isOwnInvite = preview.inviter.userId === user?.id;

  // Already friends — nothing to accept; the link just opens their profile.
  if (preview.viewerIsFriend && !isOwnInvite) {
    return <RedirectToProfile userId={preview.inviter.userId} />;
  }

  // You opened your own link — nothing to accept; point you back to Friends.
  if (isOwnInvite) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">This is your invite link</Text>
          <Text tone="secondary">Send it to a friend so they can add you.</Text>
          <Button
            label="Back to Friends"
            onPress={() => router.replace(routes.friends as Href)}
            testID="friend-accept-home"
          />
        </Card>
      </Centered>
    );
  }

  return (
    <Centered testID="friend-accept">
      <Card style={styles.card} elevated>
        <View style={styles.inviterBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${inviterName}'s profile`}
            onPress={() => openProfile(preview.inviter.userId)}
            style={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}
            testID="friend-accept-inviter"
          >
            <Avatar
              name={preview.inviter.displayName}
              imageUrl={userAvatarImageUrl(preview.inviter.userId)}
              size="lg"
              testID="friend-accept-avatar"
            />
            <Text variant="title" style={styles.inviterTitle}>
              {inviterName} wants to be friends
            </Text>
          </Pressable>
          <Text tone="secondary" style={styles.inviterCaption}>
            Accept to start comparing daily scores. You'll see each other on shared games.
          </Text>
        </View>
        <Button
          label={`Add ${inviterName}`}
          onPress={() => acceptMutation.mutate()}
          loading={acceptMutation.isPending}
          disabled={acceptMutation.isPending}
          testID="friend-accept-button"
        />
        <Button
          label="Not now"
          variant="ghost"
          onPress={() => {
            removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
            router.replace(routes.root as Href);
          }}
          disabled={acceptMutation.isPending}
          testID="friend-accept-decline"
        />
      </Card>
    </Centered>
  );
}

/**
 * Render-time redirect for an invite the viewer has already accepted: drop the
 * stash (so sign-in can't bounce back here) and replace the route with the
 * inviter's profile. A component rather than an inline effect so the hooks
 * above the early return stay unconditional.
 */
function RedirectToProfile({ userId }: { userId: string }) {
  const router = useRouter();
  const { routes } = useGamesRuntime();
  useEffect(() => {
    removeItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => {});
    router.replace(routes.friendProfile(userId) as Href);
  }, [router, routes, userId]);
  return (
    <Centered testID="friend-accept-loading">
      <ActivityIndicator color={tokens.accent.default} />
    </Centered>
  );
}
