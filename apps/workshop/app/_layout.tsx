import {
  DarkTheme,
  DefaultTheme as LightNavigationTheme,
  ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, useRouter, useSegments } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, type AuthStatus, useAuth } from "../src/hooks/useAuth";
import { PENDING_INVITE_TOKEN_KEY } from "../src/lib/inviteStash";
import { OfflineRetryWatcher } from "../src/lib/OfflineRetryWatcher";
import { createQueryClient, getPersistOptions } from "../src/lib/query";
import { getItem } from "../src/lib/storage";
import { ThemeProvider, ToastProvider, tokens } from "../src/ui/index";

function useApplyOtaUpdatesOnArrival() {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending) Updates.reloadAsync().catch(() => {});
  }, [isUpdatePending]);
}

// iOS Share Extension hand-off. When the user taps Share → "Workshop" in
// another app, expo-share-intent's native code stashes the payload in App
// Group UserDefaults and opens `workshop://dataUrl=…`; the hook reads it
// back and surfaces a `shareIntent`. We forward to `/share?url=…` which
// the existing `app/share/index.tsx` redirect maps to `/share/pick-list`.
// Signed-out users currently lose the payload — AuthGate bounces them to
// `/sign-in` first; stashing through auth (cf. inviteStash) is a follow-up.
function useShareIntentRedirect(status: AuthStatus) {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  useEffect(() => {
    if (status !== "signed-in" || !hasShareIntent) return;
    const payload = shareIntent?.webUrl ?? shareIntent?.text;
    if (!payload) return;
    router.replace(`/share?url=${encodeURIComponent(payload)}`);
    resetShareIntent();
  }, [status, hasShareIntent, shareIntent, router, resetShareIntent]);
}

function AuthGate() {
  const { status } = useAuth();
  useShareIntentRedirect(status);
  // Widen to `string[]` so segments[1] typechecks without the typed-routes
  // augmentation (`.expo/types/router.d.ts`), which is gitignored and not
  // generated in CI.
  const segments: string[] = useSegments();
  const router = useRouter();
  // Latched once we've resolved the post-sign-in destination (invite vs.
  // home). Prevents the async stash lookup from racing a synchronous
  // home-bounce: without this, two effects fire on the same status flip,
  // segments change before `await getItem(...)` resumes, the cleanup
  // `cancelled = true` fires, and the invite redirect is dropped — the
  // user lands on home with the token still sitting in localStorage.
  const postSignInResolvedRef = useRef(false);

  useEffect(() => {
    if (status === "loading") return;
    const first = segments[0];
    const onSignIn = first === "sign-in";
    const onOnboarding = first === "onboarding";
    const onAcceptInvite = onOnboarding && segments[1] === "accept-invite";
    const onInvite = first === "invite";

    if (status !== "signed-in") {
      postSignInResolvedRef.current = false;
    }

    if (status === "signed-out") {
      // Let `/invite/:token` and `/onboarding/accept-invite` mount briefly so
      // they can stash the token before AuthGate forwards to /sign-in.
      if (!onSignIn && !onInvite && !onAcceptInvite) {
        router.replace("/sign-in");
      }
      return;
    }
    if (status === "needs-display-name" && !onOnboarding) {
      router.replace("/onboarding/display-name");
      return;
    }
    // status === "signed-in". Signed-in users on `/list/...`,
    // `/create-list/...`, or `/onboarding/accept-invite` are left alone.
    const needsPostSignInBounce = onSignIn || (onOnboarding && !onAcceptInvite);
    if (!needsPostSignInBounce || postSignInResolvedRef.current) return;
    postSignInResolvedRef.current = true;

    // Consult the invite stash before bouncing to home so a user who arrived
    // via an invite link lands on the list they were invited to. The
    // accept-invite screen owns the eventual `removeItem` call.
    (async () => {
      const stashed = await getItem(PENDING_INVITE_TOKEN_KEY).catch(() => null);
      if (stashed) {
        router.replace(`/onboarding/accept-invite?token=${encodeURIComponent(stashed)}`);
      } else {
        router.replace("/");
      }
    })();
  }, [status, segments, router]);

  if (status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tokens.bg.canvas,
        }}
      >
        <ActivityIndicator color={tokens.accent.default} />
      </View>
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
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="onboarding/display-name" />
        <Stack.Screen name="create-list/type" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create-list/customize" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create-list/playlist" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="activity" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="list/[id]/index" />
        <Stack.Screen name="list/[id]/add" options={{ presentation: "modal" }} />
        <Stack.Screen name="list/[id]/add-bulk" options={{ presentation: "modal" }} />
        <Stack.Screen name="list/[id]/settings" options={{ presentation: "modal" }} />
        <Stack.Screen name="list/[id]/item/[itemId]" />
        <Stack.Screen name="onboarding/accept-invite" />
        <Stack.Screen name="invite/[token]" />
        <Stack.Screen name="share/index" />
        <Stack.Screen name="share/pick-list" options={{ animation: "slide_from_right" }} />
      </Stack>
    </SafeAreaView>
  );
}

export default function RootLayout() {
  useApplyOtaUpdatesOnArrival();
  const queryClient = useMemo(() => createQueryClient(), []);
  const persistOptions = useMemo(() => getPersistOptions(), []);
  const colorScheme = useColorScheme();
  const isLight = colorScheme === "light";
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <ThemeProvider>
            <NavigationThemeProvider value={isLight ? LightNavigationTheme : DarkTheme}>
              <StatusBar style={isLight ? "dark" : "light"} />
              <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
                <ToastProvider>
                  <OfflineRetryWatcher />
                  <AuthProvider>
                    <AuthGate />
                  </AuthProvider>
                </ToastProvider>
              </PersistQueryClientProvider>
            </NavigationThemeProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
