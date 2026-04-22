import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { AuthProvider, useAuth } from "../src/hooks/useAuth";

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
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate>
        <Stack screenOptions={{ headerShown: true, headerTitleAlign: "center" }}>
          <Stack.Screen name="index" options={{ title: "Watchlist" }} />
          <Stack.Screen name="add" options={{ title: "Add Movie", presentation: "modal" }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack>
      </AuthGate>
    </AuthProvider>
  );
}
