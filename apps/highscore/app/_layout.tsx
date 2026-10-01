// Root layout for the UX playground.
//
// Everything above the active variant lives here, and it is deliberately the
// *union* of what the five variant branches each had in their own root layout.
// Those branches differed only in two ways:
//
//   · which of their own providers they added (ux1's DeckNav, ux4's Flight +
//     Peek, ux5's Dock, and each one's own ToastProvider) — those moved into
//     `VariantProviders`, keyed on the variant; and
//   · their `Stack.Screen` animations — those moved into `RootStack` /
//     `VariantGroupLayout`.
//
// The rest — `configureApiClient`, the OTA-on-arrival hook, Press Start 2P font
// loading, the gesture/keyboard/safe-area/query/auth/games-runtime providers,
// the share-intent redirect and the whole AuthGate (redirects, stashed-invite
// resolution, the loading and "can't connect" interstitials) — was byte-for-byte
// identical on all five, so one copy serves all five. Verified by diffing the
// five `app/_layout.tsx` files against each other.
//
// `key={variant}` on `VariantProviders` is load-bearing: switching variants must
// tear the whole router subtree down, or deck panels / sheet stacks / dock
// registrations from one variant leak into the next and the comparison lies.

import { PressStart2P_400Regular, useFonts } from "@expo-google-fonts/press-start-2p";
import { QueryClientProvider } from "@tanstack/react-query";
import { configureApiClient } from "@workshop/api-client/api";
import { getItem } from "@workshop/api-client/storage";
import { type Href, useRouter, useSegments } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  PENDING_FRIEND_INVITE_TOKEN_KEY,
  PENDING_GAME_SHARE_TOKEN_KEY,
} from "../src/games/lib/inviteStash";
import { type GamesRoutes, GamesRuntimeProvider } from "../src/games/runtime";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { isPublicRoute } from "../src/lib/publicRoutes";
import { createQueryClient } from "../src/lib/query";
import { CHROME } from "../src/ux/chrome";
import { RootStack, VariantCanvas, VariantProviders } from "../src/ux/shells";
import { UxChip } from "../src/ux/UxChip";
import { UxVariantProvider, useUxVariant } from "../src/ux/variant";

configureApiClient({ client: "highscore" });

function useApplyOtaUpdatesOnArrival() {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending) Updates.reloadAsync().catch(() => {});
  }, [isUpdatePending]);
}

const HIGHSCORE_GAMES_ROUTES: GamesRoutes = {
  root: "/",
  home: "/",
  signIn: "/sign-in",
  friends: "/friends",
  game: (gameId) => `/games/${encodeURIComponent(gameId)}`,
  friendProfile: (userId, via) =>
    `/friends/${encodeURIComponent(userId)}${via ? `?via=${encodeURIComponent(via)}` : ""}`,
};

function GamesRuntimeBridge({ children }: { children: ReactNode }) {
  const { token, user, status } = useAuth();
  const value = useMemo(
    () => ({
      token,
      user,
      status,
      appName: "HighScore",
      appScheme: "highscore",
      routes: HIGHSCORE_GAMES_ROUTES,
    }),
    [status, token, user],
  );
  return <GamesRuntimeProvider value={value}>{children}</GamesRuntimeProvider>;
}

function useShareIntentRedirect(status: ReturnType<typeof useAuth>["status"]) {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  useEffect(() => {
    if (status !== "signed-in" || !hasShareIntent) return;
    const params = new URLSearchParams();
    const webUrl = shareIntent?.webUrl?.trim();
    const text = shareIntent?.text?.trim();
    if (webUrl) params.set("url", webUrl);
    if (text) params.set("text", text);
    const query = params.toString();
    if (!query) return;
    router.replace(`/share/pick-game?${query}` as Href);
    resetShareIntent();
  }, [hasShareIntent, resetShareIntent, router, shareIntent, status]);
}

function AuthGate() {
  const { status, refresh } = useAuth();
  const variant = useUxVariant();
  useShareIntentRedirect(status);
  // Widen to `string[]` so index access typechecks without the typed-routes
  // augmentation (`.expo/types/router.d.ts`), which is gitignored and not
  // generated in CI. Group segments (`(app)`) are stripped so the route checks
  // below match URL-shaped paths.
  const rawSegments: string[] = useSegments();
  const segments = rawSegments.filter((segment) => !segment.startsWith("("));
  const router = useRouter();
  const postSignInResolvedRef = useRef(false);
  // `/support` and `/privacy` are published App Store URLs: they must render
  // for a signed-out visitor, and must survive an unreachable API. Everything
  // auth-shaped below — the redirects and the two interstitials — steps aside
  // for them.
  const onPublicRoute = isPublicRoute(segments);

  useEffect(() => {
    if (status === "loading" || status === "unavailable") return;
    if (onPublicRoute) return;
    const first = segments[0];
    const onSignIn = first === "sign-in";
    const onOnboarding = first === "onboarding";
    const onFriendAccept = first === "friends" && segments[1] === "accept";
    const onGameShare = first === "g";

    if (status !== "signed-in") postSignInResolvedRef.current = false;

    if (status === "signed-out") {
      if (!onSignIn && !onFriendAccept && !onGameShare) router.replace("/sign-in");
      return;
    }
    if (status === "needs-display-name") {
      if (!onOnboarding) router.replace("/onboarding/display-name");
      return;
    }
    if ((!onSignIn && !onOnboarding) || postSignInResolvedRef.current) return;
    postSignInResolvedRef.current = true;
    void (async () => {
      const friendToken = await getItem(PENDING_FRIEND_INVITE_TOKEN_KEY).catch(() => null);
      if (friendToken) {
        router.replace(`/friends/accept/${encodeURIComponent(friendToken)}` as Href);
        return;
      }
      const gameToken = await getItem(PENDING_GAME_SHARE_TOKEN_KEY).catch(() => null);
      if (gameToken) {
        router.replace(`/g/${encodeURIComponent(gameToken)}` as Href);
        return;
      }
      router.replace("/");
    })();
  }, [status, segments, router, onPublicRoute]);

  if (status === "loading" && !onPublicRoute) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={CHROME.primary} />
      </View>
    );
  }

  if (status === "unavailable" && !onPublicRoute) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.interstitial}>
        <View style={[styles.centered, styles.interstitialBody]}>
          <View style={styles.interstitialColumn}>
            <Text style={styles.interstitialTitle}>Can’t connect</Text>
            <Text style={styles.interstitialBlurb}>
              Your session is still saved. Check your connection and try again.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again"
              onPress={() => void refresh()}
              style={styles.interstitialButton}
            >
              <Text style={styles.interstitialButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <VariantCanvas>
      <SafeAreaView edges={["top"]} style={styles.stackHost}>
        <VariantProviders key={variant} variant={variant}>
          <RootStack />
        </VariantProviders>
      </SafeAreaView>
    </VariantCanvas>
  );
}

export default function RootLayout() {
  useApplyOtaUpdatesOnArrival();
  const queryClient = useMemo(() => createQueryClient(), []);
  // HighScore is dark-only (DESIGN.md): no ThemeProvider, no useColorScheme.
  // Press Start 2P is heading/score-only on all five variants, so blocking on it
  // briefly is a dark canvas, not a blank app; render proceeds on load error too.
  const [fontsLoaded, fontError] = useFonts({ PressStart2P_400Regular });
  if (!fontsLoaded && !fontError) return <View style={styles.centered} />;
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <UxVariantProvider>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <GamesRuntimeBridge>
                  <View style={styles.root}>
                    <AuthGate />
                    {/* Outside the Stack, so the toggle is reachable from every
                        screen including sign-in and the legal pages. */}
                    <UxChip />
                  </View>
                </GamesRuntimeBridge>
              </AuthProvider>
            </QueryClientProvider>
          </UxVariantProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CHROME.ink },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CHROME.ink,
  },
  stackHost: { flex: 1 },
  interstitial: { flex: 1, backgroundColor: CHROME.ink },
  interstitialBody: { paddingHorizontal: 24 },
  interstitialColumn: { width: "100%", maxWidth: 340, gap: 12 },
  interstitialTitle: {
    color: CHROME.textPrimary,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  interstitialBlurb: { color: CHROME.textSecondary, fontSize: 14, textAlign: "center" },
  interstitialButton: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: CHROME.bezel,
    borderColor: CHROME.border,
    backgroundColor: CHROME.surface2,
  },
  interstitialButtonLabel: { color: CHROME.textPrimary, fontSize: 15, fontWeight: "600" },
});
