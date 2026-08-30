import { Tabs } from "expo-router";
import { hsColor } from "../../src/theme";

// Minimal tab shell. HighScore ships a single surface today (the Games home);
// the group exists so PR-4 can drop the Games routes plus a Friends/Profile
// sibling in without restructuring the router. The bottom bar is hidden on
// every platform — top-level navigation lives in screen headers.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: hsColor.bg },
        tabBarActiveTintColor: hsColor.primary,
        tabBarInactiveTintColor: hsColor.textSecondary,
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Games" }} />
    </Tabs>
  );
}
