import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { fetchGameShareLink } from "../../src/api/games";
import { useAuth } from "../../src/hooks/useAuth";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import { PENDING_GAME_SHARE_TOKEN_KEY } from "../../src/lib/inviteStash";
import { queryKeys } from "../../src/lib/queryKeys";
import { removeItem, setItem } from "../../src/lib/storage";
import { Button, Card, Text, tokens } from "../../src/ui/index";

/**
 * Deep-link landing for a play link (`/g/:token`, the Games-tab copy-scores
 * CTA, minted by `POST /v1/game-share`). Unlike the friend-invite accept screen
 * this page renders no UI of its own beyond a spinner — it *resolves* the link
 * and forwards:
 *   - viewer is already friends with the sharer (or is the sharer) → Games home
 *   - otherwise → the sharer's profile, where they can add them as a friend.
 *
 * The sign-in round-trip mirrors the friend accept flow: stash the token so a
 * signed-out recipient who signs in mid-flow lands back here (AuthGate consults
 * the stash in its post-sign-in bounce, and lets `/g/*` mount signed-out).
 */
export default function GameShareLanding() {
  const params = useLocalSearchParams<{ token?: string }>();
  const linkToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken } = useAuth();
  const router = useRouter();

  // Stash on mount so a redirect through /sign-in can recover the token. Gated
  // on the flag so a stale link can never strand a prod (flag-off) user.
  useEffect(() => {
    if (!GAMES_TAB_ENABLED || !linkToken) return;
    setItem(PENDING_GAME_SHARE_TOKEN_KEY, linkToken).catch(() => {});
  }, [linkToken]);

  // Signed-out → send through sign-in. AuthGate bounces back here once signed in.
  useEffect(() => {
    if (!GAMES_TAB_ENABLED) return;
    if (status === "signed-out" && linkToken) {
      router.replace("/sign-in");
    }
  }, [status, linkToken, router]);

  const resolveQuery = useQuery({
    queryKey: queryKeys.games.shareLink(linkToken ?? ""),
    queryFn: () => fetchGameShareLink(linkToken ?? "", authToken),
    enabled: GAMES_TAB_ENABLED && !!linkToken && status === "signed-in",
    // This result drives a one-shot redirect, so it must reflect the *current*
    // friendship — never a stale 30s-cached / persisted resolve. `gcTime: 0`
    // drops it on unmount (right after we redirect), so re-opening the same link
    // after the relationship changed always refetches instead of routing stale.
    staleTime: 0,
    gcTime: 0,
  });

  // Route once resolved. The stash has done its job — clear it either way.
  useEffect(() => {
    if (!resolveQuery.isSuccess) return;
    removeItem(PENDING_GAME_SHARE_TOKEN_KEY).catch(() => {});
    const { user, viewer } = resolveQuery.data;
    if (viewer?.isSelf || viewer?.isFriend) {
      router.replace("/games");
    } else {
      router.replace({
        pathname: "/friends/[userId]",
        params: { userId: user.userId, via: linkToken ?? "" },
      });
    }
  }, [resolveQuery.isSuccess, resolveQuery.data, router, linkToken]);

  if (!GAMES_TAB_ENABLED) {
    return <Redirect href="/" />;
  }

  if (!linkToken) {
    return (
      <Centered>
        <Card style={styles.card} elevated>
          <Text variant="title">Link missing token</Text>
          <Text tone="secondary">Ask your friend to send you a fresh link.</Text>
          <Button label="Go home" onPress={() => router.replace("/")} testID="game-share-home" />
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
          <Button label="Go home" onPress={() => router.replace("/")} testID="game-share-home" />
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

function Centered({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: tokens.space.xl,
    gap: tokens.space.md,
  },
  card: {
    gap: tokens.space.md,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
});
