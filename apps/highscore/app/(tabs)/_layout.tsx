import { Tabs } from "expo-router";
import { tokens } from "../../src/theme";

// Router-level tab shell, deliberately inert: HighScore has exactly one
// screen. Panel switching (deck / players / you) happens inside `AppShell`,
// not here, so the native tab bar stays hidden on every platform.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.bg.canvas },
        tabBarActiveTintColor: tokens.neon.pink,
        tabBarInactiveTintColor: tokens.text.secondary,
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "HighScore" }} />
    </Tabs>
  );
}
