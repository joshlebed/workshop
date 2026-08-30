import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@workshop/api-client/queryKeys";
import { removeItem, setItem } from "@workshop/api-client/storage";
import { Button, Card, Text } from "@workshop/ui";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { tokens } from "../../theme";
import { fetchGameShareLink } from "../api/games";
import { OpenInAppCard } from "../components/OpenInAppCard";
import { isInAppBrowser } from "../lib/inAppBrowser";
import { PENDING_GAME_SHARE_TOKEN_KEY } from "../lib/inviteStash";
import { useGamesRuntime } from "../runtime";

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
 *
 * In a third-party in-app browser (Messenger / Instagram) we don't resolve at
 * all — iOS can't auto-open the app from a Universal Link there — so we surface
 * an "Open in app" card (`OpenInAppCard`) whose button is the app's custom
 * scheme (which routes to the installed app on a tap regardless
 * of Universal Link state), and only proceed on web if the user opts out.
 */
export default function GameShareLanding() {
  const params = useLocalSearchParams<{ token?: string }>();
  const linkToken = Array.isArray(params.token) ? params.token[0] : params.token;
  const { status, token: authToken, appName, appScheme, routes } = useGamesRuntime();
  const router = useRouter();

  // Inside an in-app browser, offer "Open in app" instead of silently resolving
  // on web (the page load can't trigger the Universal Link — only a user tap
  // can). `continuedOnWeb` is the escape hatch back to the normal web flow.
  const inAppBrowser = useMemo(() => isInAppBrowser(), []);
  const [continuedOnWeb, setContinuedOnWeb] = useState(false);
  const showAppPrompt = Platform.OS === "web" && !!linkToken && inAppBrowser && !continuedOnWeb;

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

  // Route once resolved. The stash has done its job — clear it either way.
  useEffect(() => {
    if (!resolveQuery.isSuccess) return;
    removeItem(PENDING_GAME_SHARE_TOKEN_KEY).catch(() => {});
    const { user, viewer } = resolveQuery.data;
    if (viewer?.isSelf || viewer?.isFriend) {
      router.replace(routes.home as Href);
    } else {
      router.replace(routes.friendProfile(user.userId, linkToken ?? "") as Href);
    }
  }, [resolveQuery.isSuccess, resolveQuery.data, router, linkToken, routes]);

  // In-app browser: offer the app before doing anything web-side. The button
  // targets the host app's custom scheme, which a tap routes
  // straight to the installed app — unlike the https Universal Link, which (being
  // the same URL this page is on) just reloads into a loop and, per reports,
  // doesn't reliably open the app even from native contexts like iMessage.
  if (showAppPrompt) {
    return (
      <Centered testID="game-share-open-in-app">
        <OpenInAppCard
          appName={appName}
          url={`${appScheme}:///g/${encodeURIComponent(linkToken ?? "")}`}
          onContinue={() => setContinuedOnWeb(true)}
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
