import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@workshop/api-client/api";
import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import { sendFriendRequest } from "@workshop/api-client/friends";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { removeItem, setItem } from "@workshop/api-client/storage";
import { haptics } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Avatar, Button, Card, Text, tokens } from "../../theme";
import { fetchGameShareLink } from "../api/games";
import { OpenInAppCard } from "../components/OpenInAppCard";
import { useInAppBrowserPrompt } from "../hooks/useInAppBrowserPrompt";
import { useOpenProfile } from "../hooks/useOpenProfile";
import { PENDING_GAME_SHARE_TOKEN_KEY } from "../lib/inviteStash";
import { useGamesRuntime } from "../runtime";
import { Centered, PostAcceptPicker, styles } from "./friendAccept/PostAcceptPicker";

/**
 * Deep-link landing for a play link (`/g/:token`, the Games-tab copy-scores
 * CTA, minted by `POST /v1/game-share`). Resolves the link, then:
 *   - viewer is already friends with the sharer (or is the sharer) → Games home
 *   - otherwise → an accept card ("Josh wants to compare scores"), like the
 *     friend-invite screen. "Add Josh" sends a friend request *vouched by the
 *     play token* (`via`), which the backend turns into a friendship at once,
 *     then the shared `PostAcceptPicker` offers the sharer's games. The two
 *     link kinds converge on the same onboarding from here.
 *
 * The sign-in round-trip mirrors the friend accept flow: stash the token so a
 * signed-out recipient who signs in mid-flow lands back here (AuthGate consults
 * the stash in its post-sign-in bounce, and lets `/g/*` mount signed-out).
 *
 * In a third-party browser, pause web resolution while OpenInAppCard attempts
 * an iOS handoff. Browsers that block it still offer a real link and web fallback.
 */
export default function GameShareLanding() {
  const params = useLocalSearchParams<{ token?: string }>();
  const linkToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken, appName, appScheme, routes } = useGamesRuntime();
  const router = useRouter();
  const openProfile = useOpenProfile();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [acceptedFriend, setAcceptedFriend] = useState<{
    userId: string;
    displayName: string | null;
  } | null>(null);

  // Let the handoff card run before resolving or redirecting through sign-in.
  const { showAppPrompt, continueOnWeb } = useInAppBrowserPrompt(
    linkToken ? `/g/${encodeURIComponent(linkToken)}` : null,
  );

  // Stash on mount so a redirect through /sign-in can recover the token. Gated
  // on the flag so a stale link can never strand a prod (flag-off) user.
  useEffect(() => {
    if (!linkToken) return;
    setItem(PENDING_GAME_SHARE_TOKEN_KEY, linkToken).catch(() => {});
  }, [linkToken]);

  // Signed-out → send through sign-in. AuthGate bounces back here once signed in.
  // Held while the in-app-browser prompt is up so the user sees it first.
  useEffect(() => {
    if (showAppPrompt) return;
    if (status === "signed-out" && linkToken) {
      router.replace(routes.signIn as Href);
    }
  }, [status, linkToken, router, routes.signIn, showAppPrompt]);

  const resolveQuery = useQuery({
    queryKey: queryKeys.games.shareLink(linkToken ?? ""),
    queryFn: () => fetchGameShareLink(linkToken ?? "", authToken),
    enabled: !!linkToken && status === "signed-in" && !showAppPrompt,
    // This result drives a one-shot redirect, so it must reflect the *current*
    // friendship — never a stale 30s-cached / persisted resolve. `gcTime: 0`
    // drops it on unmount (right after we redirect), so re-opening the same link
    // after the relationship changed always refetches instead of routing stale.
    staleTime: 0,
    gcTime: 0,
  });

  // Already connected → home. Otherwise stay: the accept card renders below.
  // Decided once, on the first resolve: accepting invalidates `["games"]`,
  // which refetches this query (its key lives under that prefix) with
  // `isFriend: true` — that must not bounce the picker to home.
  const decidedRef = useRef(false);
  useEffect(() => {
    if (!resolveQuery.isSuccess || decidedRef.current) return;
    decidedRef.current = true;
    removeItem(PENDING_GAME_SHARE_TOKEN_KEY).catch(() => {});
    const { viewer } = resolveQuery.data;
    if (viewer?.isSelf || viewer?.isFriend) router.replace(routes.home as Href);
  }, [resolveQuery.isSuccess, resolveQuery.data, router, routes]);

  const acceptMutation = useMutation({
    mutationFn: () =>
      sendFriendRequest(resolveQuery.data?.user.userId ?? "", authToken, {
        via: linkToken ?? "",
      }),
    onSuccess: async (data) => {
      haptics.medium();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.friends.all }),
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
      // `accepted` is the vouched path. `pending` can only happen if the
      // token stopped resolving between the preview and the tap — then the
      // request is real but not yet a friendship; say so instead of faking it.
      if (data.status === "accepted" && data.friend) {
        setAcceptedFriend({ userId: data.friend.userId, displayName: data.friend.displayName });
      } else {
        setError("Request sent — you'll see each other's scores once they accept.");
      }
    },
    onError: (e) => setError(errorMessage(e, "Couldn't add your friend")),
  });

  if (showAppPrompt) {
    return (
      <Centered testID="game-share-open-in-app">
        <OpenInAppCard
          appName={appName}
          url={`${appScheme}:///g/${encodeURIComponent(linkToken ?? "")}`}
          onContinue={continueOnWeb}
        />
      </Centered>
    );
  }

  if (!linkToken) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Link missing token</Text>
          <Text tone="secondary">Ask your friend to send you a fresh link.</Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="game-share-home"
          />
        </Card>
      </Centered>
    );
  }

  if (resolveQuery.isError) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Link not found</Text>
          <Text tone="secondary" testID="game-share-error">
            This link isn't valid anymore.
          </Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="game-share-home"
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
          <Text tone="secondary" testID="game-share-accept-error">
            {error}
          </Text>
          <Button
            label="Go home"
            onPress={() => router.replace(routes.root as Href)}
            testID="game-share-home"
          />
        </Card>
      </Centered>
    );
  }

  // Friends now — pick which of the sharer's games to add (skippable).
  if (acceptedFriend) {
    return (
      <PostAcceptPicker
        friend={acceptedFriend}
        token={authToken}
        onDone={() => router.replace(routes.home as Href)}
      />
    );
  }

  const resolved = resolveQuery.isSuccess ? resolveQuery.data : null;
  if (resolved && !resolved.viewer?.isSelf && !resolved.viewer?.isFriend) {
    const sharer = resolved.user;
    const sharerName = sharer.displayName?.trim() || "Someone";
    return (
      <Centered testID="game-share-accept">
        <Card style={styles.card} elevated>
          <View style={styles.inviterBlock}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${sharerName}'s profile`}
              onPress={() => openProfile(sharer.userId, linkToken ?? undefined)}
              style={({ pressed }) => [styles.identity, pressed && styles.identityPressed]}
              testID="game-share-sharer"
            >
              <Avatar
                name={sharer.displayName}
                imageUrl={userAvatarImageUrl(sharer.userId)}
                size="lg"
              />
              <Text variant="title" style={styles.inviterTitle}>
                {sharerName} wants to compare scores
              </Text>
            </Pressable>
            <Text tone="secondary" style={styles.inviterCaption}>
              Add {sharerName} to see each other's daily scores on the games you share.
            </Text>
          </View>
          <Button
            label={`Add ${sharerName}`}
            onPress={() => acceptMutation.mutate()}
            loading={acceptMutation.isPending}
            disabled={acceptMutation.isPending}
            testID="game-share-accept-button"
          />
          <Button
            label="Not now"
            variant="ghost"
            onPress={() => router.replace(routes.root as Href)}
            disabled={acceptMutation.isPending}
            testID="game-share-decline"
          />
        </Card>
      </Centered>
    );
  }

  // Resolving auth / the link, or already redirecting — show a spinner.
  return (
    <Centered testID="game-share-loading">
      <ActivityIndicator color={tokens.accent.default} />
    </Centered>
  );
}
