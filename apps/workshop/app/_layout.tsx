import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";

function useApplyOtaUpdatesOnArrival() {
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending) Updates.reloadAsync().catch(() => {});
  }, [isUpdatePending]);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuthGroup = segments[0] === "sign-in";
    if (!user && !inAuthGroup) router.replace("/sign-in");
    else if (user && inAuthGroup) router.replace("/");
  }, [user, ready, segments, router]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#1a1a1a",
        }}
      >
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  useApplyOtaUpdatesOnArrival();
  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AuthProvider>
        <AuthGate>
          <Stack
            screenOptions={{
              headerShown: true,
              headerTitleAlign: "center",
              headerStyle: { backgroundColor: "#1a1a1a" },
              headerTintColor: "#fff",
              contentStyle: { backgroundColor: "#1a1a1a" },
            }}
          >
            <Stack.Screen name="index" options={{ title: "Watchlist" }} />
            <Stack.Screen name="add" options={{ title: "Add Movie", presentation: "modal" }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack>
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
