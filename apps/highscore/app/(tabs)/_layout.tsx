import { Tabs } from "expo-router";
import { tokens } from "../../src/theme";

// Minimal tab shell. Top-level navigation is the bottom KeyPanel (a plain
// component rendered by each screen), not expo-router tabs — the panel has to
// sit on detail screens too, and a Tabs bar can't. The group stays so the
// router tree keeps its shape.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.bg.canvas },
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Today" }} />
    </Tabs>
  );
}
