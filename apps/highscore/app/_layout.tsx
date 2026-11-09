import { PressStart2P_400Regular } from "@expo-google-fonts/press-start-2p";
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import { QueryClientProvider } from "@tanstack/react-query";
import { configureApiClient } from "@workshop/api-client/api";
import { stashSignupLanding } from "@workshop/api-client/signupAcquisition";
import { getItem } from "@workshop/api-client/storage";
import { useFonts } from "expo-font";
import { type Href, Stack, useRouter, useSegments } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { reportShareIntent, type ShareIntentTelemetry } from "../src/api/telemetry";
import { PlayReminderPromptProvider } from "../src/components/PlayReminderPrompt";
import { UpdateRequiredScreen } from "../src/components/UpdateRequiredScreen";
import {
  PENDING_FRIEND_INVITE_TOKEN_KEY,
  PENDING_GAME_SHARE_TOKEN_KEY,
} from "../src/games/lib/inviteStash";
import { type GamesRoutes, GamesRuntimeProvider } from "../src/games/runtime";
import { ViewDayProvider } from "../src/games/state/viewDay";
import { useAppReleaseNudge } from "../src/hooks/useAppRelease";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { isPublicRoute } from "../src/lib/publicRoutes";
import { addResponseListener, notificationPath } from "../src/lib/pushNotifications";
import { registerPushTokenIfGranted } from "../src/lib/pushRegistration";
import { createQueryClient } from "../src/lib/query";
import { isSharePractice } from "../src/lib/shareOnboarding";
import { markSharePracticeReceived } from "../src/lib/sharePractice";
import { Button, Text, ToastProvider, tokens } from "../src/theme";

// Web: remember the very first page load's referrer / landing path / utm_* for
// signup attribution, before any redirect rewrites the URL (no-op on native and
// after the first visit). Sent with the next Apple/Google sign-in.
void stashSignupLanding();

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
  share: "/share",
  addGame: "/games/add",
  game: (gameId, date) =>
    `/games/${encodeURIComponent(gameId)}${date ? `?date=${encodeURIComponent(date)}` : ""}`,
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

/**
 * Routes an iOS share-sheet payload to `/share/pick-game` once there's a
 * session. Returns whether a payload is still pending so `AuthGate`'s
 * post-sign-in resolver can step aside — otherwise its async
 * `router.replace("/")` lands after this redirect and silently discards a
 * score shared while signed out.
 */
function useShareIntentRedirect(status: ReturnType<typeof useAuth>["status"]): boolean {
  const router = useRouter();
  const { token } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  // Dedupe telemetry to one report per distinct payload (the effect re-runs on
  // unrelated renders while the intent is pending).
  const lastReportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "signed-in" || !hasShareIntent) return;

    const signature = `${shareIntent?.type ?? ""}|${shareIntent?.webUrl ?? ""}|${shareIntent?.text ?? ""}`;
    if (lastReportedRef.current !== signature) {
      lastReportedRef.current = signature;
      void reportShareIntent(buildShareIntentTelemetry(shareIntent, "layout-redirect"), token);
    }

    const params = new URLSearchParams();
    const webUrl = shareIntent?.webUrl?.trim();
    const text = shareIntent?.text?.trim();
    // The share-setup walkthrough's practice share coming back: confirm the
    // setup worked rather than offering to post it as a score.
    if (isSharePractice(text)) {
      markSharePracticeReceived();
      router.navigate("/share-setup?tested=1" as Href);
      resetShareIntent();
      return;
    }
    if (webUrl) params.set("url", webUrl);
    if (text) params.set("text", text);
    const query = params.toString();
    if (!query) return;
    // Marks the score write's provenance as the iOS share sheet — PickGame
    // sends `entrySource: "share_extension"` on the upsert when it sees this.
    params.set("via", "share-extension");
    router.replace(`/share/pick-game?${params.toString()}` as Href);
    resetShareIntent();
  }, [hasShareIntent, resetShareIntent, router, shareIntent, status, token]);
  return hasShareIntent;
}

type ShareIntentPayload = ReturnType<typeof useShareIntent>["shareIntent"];

// Snapshot the shape of what the native share extension handed us — capped
// previews only; the share text is the user's own game result.
function buildShareIntentTelemetry(
  shareIntent: ShareIntentPayload,
  source: string,
): ShareIntentTelemetry {
  const text = shareIntent?.text ?? null;
  const webUrl = shareIntent?.webUrl ?? null;
  const meta: unknown = shareIntent?.meta;
  const files: unknown = shareIntent?.files;
  return {
    source,
    type: shareIntent?.type ?? null,
    hasWebUrl: !!webUrl,
    webUrlLen: webUrl?.length ?? 0,
    hasText: !!text,
    textLen: text?.length ?? 0,
    textPreview: text ? text.slice(0, 240) : undefined,
    webUrlPreview: webUrl ? webUrl.slice(0, 240) : undefined,
    fileCount: Array.isArray(files) ? files.length : 0,
    metaKeys:
      meta && typeof meta === "object" ? Object.keys(meta as object).slice(0, 40) : undefined,
    runtimeVersion: Updates.runtimeVersion ?? null,
    updateId: Updates.updateId ?? null,
  };
}

/**
 * Daily-play reminders (no-ops on web and pre-1.2.0 binaries — see
 * `src/lib/pushNotifications.ts`): re-post an already-granted push token once
 * per launch, and route a tapped notification (`data.url`, `highscore:///`) —
 * including the one that cold-started the app. Waits for `signed-in` so the
 * Stack is mounted before navigating. Never while impersonating: the device's
 * token belongs to the real account.
 */
function usePushNotifications(status: ReturnType<typeof useAuth>["status"]) {
  const router = useRouter();
  const { token, user, impersonation } = useAuth();
  const userId = user?.id ?? null;
  useEffect(() => {
    if (status !== "signed-in" || !token || !userId || impersonation) return;
    void registerPushTokenIfGranted(token, userId);
  }, [status, token, userId, impersonation]);
  useEffect(() => {
    if (status !== "signed-in") return;
    return addResponseListener((url) => {
      router.navigate(notificationPath(url) as Href);
    });
  }, [status, router]);
}

function AuthGate() {
  const { status, refresh } = useAuth();
  const shareIntentPending = useShareIntentRedirect(status);
  usePushNotifications(status);
  // Widen to `string[]` so index access typechecks without the typed-routes
  // augmentation (`.expo/types/router.d.ts`), which is gitignored and not
  // generated in CI. Group segments (`(tabs)`) are stripped so the route
  // checks below match URL-shaped paths.
  const rawSegments: string[] = useSegments();
  const segments = rawSegments.filter((segment) => !segment.startsWith("("));
  const router = useRouter();
  const postSignInResolvedRef = useRef(false);
  // `/support`, `/privacy` and `/terms` are published App Store URLs: they must render
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
    // A share payload is already being routed by `useShareIntentRedirect`
    // (same commit, declared first). Don't race it with a home redirect.
    if (shareIntentPending) return;
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
  }, [status, segments, router, onPublicRoute, shareIntentPending]);

  // Operator-set minimum version (admin dashboard only): below it, nothing but
  // the store. Checked before the auth interstitials — the release read is
  // public, and an unsupported binary may not be able to sign in at all.
  // Public pages (App Store support / privacy / terms URLs) still render.
  const releaseNudge = useAppReleaseNudge();
  if (releaseNudge.kind === "required" && !onPublicRoute) {
    return <UpdateRequiredScreen storeUrl={releaseNudge.storeUrl} message={releaseNudge.message} />;
  }

  if (status === "loading" && !onPublicRoute) {
    return (
      <View style={centered}>
        <ActivityIndicator color={tokens.accent.default} />
      </View>
    );
  }

  if (status === "unavailable" && !onPublicRoute) {
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
        <Stack.Screen name="games/add" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="games/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="friends/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="friends/[userId]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="friends/accept/[token]" />
        <Stack.Screen name="g/[token]" />
        <Stack.Screen name="share/index" />
        <Stack.Screen name="share/pick-game" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="profile" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="settings/notifications" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="admin/index" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="admin/analytics" />
        <Stack.Screen name="admin/graph" />
        <Stack.Screen name="share-setup" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="support" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="privacy" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="terms" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="onboarding/display-name" />
      </Stack>
    </SafeAreaView>
  );
}

const fontLoadingCanvas = { flex: 1, backgroundColor: tokens.bg.canvas } as const;

const centered = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: tokens.bg.canvas,
} as const;

export default function RootLayout() {
  useApplyOtaUpdatesOnArrival();
  const queryClient = useMemo(() => createQueryClient(), []);
  // HighScore is dark-only (DESIGN.md). Each Space Grotesk weight is its own
  // family so no faux bold is ever synthesised. Blocking on the fonts is a
  // brief dark canvas, not a blank app; render proceeds on a load error too
  // (the system face stands in).
  const [fontsLoaded, fontError] = useFonts({
    PressStart2P_400Regular,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });
  if (!fontsLoaded && !fontError) return <View style={fontLoadingCanvas} />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <AuthProvider>
                <GamesRuntimeBridge>
                  <ViewDayProvider>
                    <PlayReminderPromptProvider>
                      <AuthGate />
                    </PlayReminderPromptProvider>
                  </ViewDayProvider>
                </GamesRuntimeBridge>
              </AuthProvider>
            </ToastProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
