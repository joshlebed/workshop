import { Tabs } from "expo-router";
import { Platform, Text as RNText, View } from "react-native";
import { GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import { tokens } from "../../src/ui/index";
import { SidebarTabSwitch } from "../../src/ui/Layout";

// Top-level Lists / Games switch (spec §4). The Lists tab is the existing
// app — the whole pre-Games stack nests under the `(lists)` group, so every
// route keeps its URL (group segments never appear in paths) and deep links /
// share-intent redirects are unchanged.
//
// Flag off (production today): the Games screen is unlinked and the tab bar
// is hidden, so the shell renders exactly like the pre-tabs app. Flag on:
// native gets a bottom tab bar; web hides it and shows the sidebar switch
// instead (rendered here, defined in src/ui/Layout.tsx).
// Uses the static `tokens` (not `useTheme()`) for backgrounds, matching the
// root layout's Stack `contentStyle` — mixing the theme-resolved tokens here
// paints a light scene behind dark screen content in light-preferring
// browsers.
export default function TabsLayout() {
  const showNativeTabBar = GAMES_TAB_ENABLED && Platform.OS !== "web";

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.bg.canvas },
        tabBarActiveTintColor: tokens.accent.default,
        tabBarInactiveTintColor: tokens.text.muted,
        tabBarStyle: showNativeTabBar
          ? { backgroundColor: tokens.bg.surface, borderTopColor: tokens.bg.elevated }
          : { display: "none" },
      }}
    >
      <Tabs.Screen
        name="(lists)"
        options={{
          title: "Lists",
          tabBarIcon: ({ color }) => <RNText style={{ color, fontSize: 17 }}>◧</RNText>,
        }}
      />
      <Tabs.Screen
        name="games"
        options={
          GAMES_TAB_ENABLED
            ? {
                title: "Games",
                tabBarIcon: ({ color }) => <RNText style={{ color, fontSize: 17 }}>◆</RNText>,
              }
            : { href: null }
        }
      />
    </Tabs>
  );

  if (Platform.OS === "web" && GAMES_TAB_ENABLED) {
    return (
      <View style={{ flex: 1, flexDirection: "row" }}>
        <SidebarTabSwitch />
        <View style={{ flex: 1 }}>{tabs}</View>
      </View>
    );
  }
  return tabs;
}
