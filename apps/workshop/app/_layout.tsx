import {
  DarkTheme,
  DefaultTheme as LightNavigationTheme,
  ThemeProvider as NavigationThemeProvider,
} from "@react-navigation/native";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, useColorScheme, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
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

function AuthGate() {
  const { status } = useAuth();
  // Widen to `string[]` so segments[1] typechecks without the typed-routes
  // augmentation (`.expo/types/router.d.ts`), which is gitignored and not
  // generated in CI.
  const segments: string[] = useSegments();
  const router = useRouter();
  // After sign-in we ask once whether a pending invite token is stashed and
  // bounce the user to the accept-invite handler. The ref keeps the check
  // from re-firing every time `segments` updates while the user is already
  // signed-in.
  const inviteCheckedRef = useRef(false);

  useEffect(() => {
    if (status === "loading") return;
    const first = segments[0];
    const onSignIn = first === "sign-in";
    const onOnboarding = first === "onboarding";
    const onAcceptInvite = onOnboarding && segments[1] === "accept-invite";
    const onInvite = first === "invite";

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
    if (status === "signed-in" && (onSignIn || (onOnboarding && !onAcceptInvite))) {
      router.replace("/");
    }
    // Signed-in users on `/list/...`, `/create-list/...`, or
    // `/onboarding/accept-invite` are left alone — those flows live under
    // the same root stack and don't trigger redirects.
  }, [status, segments, router]);

  // Post-sign-in invite redirect: when status flips to signed-in, consult the
  // stashed invite token (set by the accept-invite screen before the user
  // bounced through sign-in) and forward there if present. Run once per
  // sign-in transition to avoid loops.
  useEffect(() => {
    if (status !== "signed-in") {
      inviteCheckedRef.current = false;
      return;
    }
    if (inviteCheckedRef.current) return;
    inviteCheckedRef.current = true;
    let cancelled = false;
    (async () => {
      const stashed = await getItem(PENDING_INVITE_TOKEN_KEY).catch(() => null);
      if (cancelled || !stashed) return;
      const first = segments[0];
      const onAcceptInvite = first === "onboarding" && segments[1] === "accept-invite";
      if (onAcceptInvite) return;
      // The accept-invite screen owns the eventual `removeItem` call so we
      // only need to redirect here.
      router.replace(`/onboarding/accept-invite?token=${encodeURIComponent(stashed)}`);
    })();
    return () => {
      cancelled = true;
    };
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
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="onboarding/display-name" />
        <Stack.Screen name="create-list/type" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create-list/customize" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create-list/playlist" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="create-list/share" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="activity" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="list/[id]/index" />
        <Stack.Screen name="list/[id]/add" options={{ presentation: "modal" }} />
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
    </GestureHandlerRootView>
  );
}
