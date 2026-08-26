import { QueryClientProvider } from "@tanstack/react-query";
import { configureApiClient } from "@workshop/api-client/api";
import { getItem } from "@workshop/api-client/storage";
import {
  PENDING_FRIEND_INVITE_TOKEN_KEY,
  PENDING_GAME_SHARE_TOKEN_KEY,
} from "@workshop/games/lib/inviteStash";
import { type GamesRoutes, GamesRuntimeProvider } from "@workshop/games/runtime";
import { Button, Text, ThemeProvider, ToastProvider, tokens } from "@workshop/ui";
import { type Href, Stack, useRouter, useSegments } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { createQueryClient } from "../src/lib/query";

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
  useShareIntentRedirect(status);
  // Widen to `string[]` so index access typechecks without the typed-routes
  // augmentation (`.expo/types/router.d.ts`), which is gitignored and not
  // generated in CI. Group segments (`(tabs)`) are stripped so the route
  // checks below match URL-shaped paths.
  const rawSegments: string[] = useSegments();
  const segments = rawSegments.filter((segment) => !segment.startsWith("("));
  const router = useRouter();
  const postSignInResolvedRef = useRef(false);

  useEffect(() => {
    if (status === "loading" || status === "unavailable") return;
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
  }, [status, segments, router]);

  if (status === "loading") {
    return (
      <View style={centered}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (status === "unavailable") {
    return (
      <SafeAreaView
        edges={["top", "bottom"]}
        style={{ flex: 1, backgroundColor: tokens.bg.canvas }}
      >
        <View style={{ ...centered, paddingHorizontal: tokens.space.xl }}>
          <View style={{ width: "100%", maxWidth: 340, gap: tokens.space.md }}>
            <Text variant="heading" style={{ textAlign: "center" }}>
              Can’t connect
            </Text>
            <Text tone="secondary" style={{ textAlign: "center" }}>
              Your session is still saved. Check your connection and try again.
            </Text>
            <Button label="Try again" size="lg" onPress={() => void refresh()} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: tokens.bg.canvas }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: tokens.bg.canvas },
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="games/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="friends/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="friends/[userId]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="friends/accept/[token]" />
        <Stack.Screen name="g/[token]" />
        <Stack.Screen name="share/index" />
        <Stack.Screen name="share/pick-game" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="onboarding/display-name" />
      </Stack>
    </SafeAreaView>
  );
}

const centered = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: tokens.bg.canvas,
} as const;

export default function RootLayout() {
  useApplyOtaUpdatesOnArrival();
  const queryClient = useMemo(() => createQueryClient(), []);
  const colorScheme = useColorScheme();
  const isLight = colorScheme === "light";
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <StatusBar style={isLight ? "dark" : "light"} />
            <QueryClientProvider client={queryClient}>
              <ToastProvider>
                <AuthProvider>
                  <GamesRuntimeBridge>
                    <AuthGate />
                  </GamesRuntimeBridge>
                </AuthProvider>
              </ToastProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
