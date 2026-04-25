import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";
import { createQueryClient } from "../src/lib/query";
import { ToastProvider, tokens } from "../src/ui/index";

function useApplyOtaUpdatesOnArrival() {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending) Updates.reloadAsync().catch(() => {});
  }, [isUpdatePending]);
}

function AuthGate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    const first = segments[0];
    const onSignIn = first === "sign-in";
    const onOnboarding = first === "onboarding";

    if (status === "signed-out" && !onSignIn) {
      router.replace("/sign-in");
    } else if (status === "needs-display-name" && !onOnboarding) {
      router.replace("/onboarding/display-name");
    } else if (status === "signed-in" && (onSignIn || onOnboarding)) {
      router.replace("/");
    }
    // Signed-in users on `/list/...` or `/create-list/...` are left alone —
    // those flows live under the same root stack and don't trigger redirects.
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
      <Stack.Screen name="list/[id]/index" />
      <Stack.Screen name="list/[id]/add" options={{ presentation: "modal" }} />
      <Stack.Screen name="list/[id]/item/[itemId]" />
      <Stack.Screen name="spotify/index" />
      <Stack.Screen name="spotify/albums" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="spotify/now-playing" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="spotify/playlists" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="spotify/playlist/[id]" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}

export default function RootLayout() {
  useApplyOtaUpdatesOnArrival();
  const queryClient = useMemo(() => createQueryClient(), []);
  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
