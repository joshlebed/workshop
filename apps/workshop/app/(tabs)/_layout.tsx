import { tokens } from "@workshop/ui";
import { Tabs } from "expo-router";

// The tab shell now holds a single tab: Lists. The Games tab was removed on
// 2026-11-06 (games live in HighScore). The `(tabs)` / `(lists)` route groups
// stay so no URL, deep link, or `withAnchor` replace changes — group segments
// never appear in paths. The bottom tab bar stays hidden on every platform.
// Uses the static `tokens` (not `useTheme()`) for backgrounds, matching the
// root layout's Stack `contentStyle` — mixing the theme-resolved tokens here
// paints a light scene behind dark screen content in light-preferring
// browsers.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.bg.canvas },
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="(lists)" options={{ title: "Lists" }} />
    </Tabs>
  );
}
