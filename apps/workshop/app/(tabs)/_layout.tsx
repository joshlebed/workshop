import { tokens } from "@workshop/ui";
import { Tabs, usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Text as RNText } from "react-native";
import { LEGACY_GAMES_TAB_ENABLED } from "../../src/lib/featureFlags";
import {
  getPreferredHomeTab,
  homeTabForPathname,
  setPreferredHomeTab,
} from "../../src/lib/navigationPreferences";

// Top-level Lists / Games switch (spec §4). The Lists tab is the existing
// app — the whole pre-Games stack nests under the `(lists)` group, so every
// route keeps its URL (group segments never appear in paths) and deep links /
// share-intent redirects are unchanged.
//
// Flag off: the Games screen is unlinked and the tab bar is hidden, so the
// shell renders exactly like the pre-tabs app. Flag on: both web and native
// hide the bottom tab bar and render the inline Lists / Games switch at the
// top of their screen headers, next to the existing action icons.
// Uses the static `tokens` (not `useTheme()`) for backgrounds, matching the
// root layout's Stack `contentStyle` — mixing the theme-resolved tokens here
// paints a light scene behind dark screen content in light-preferring
// browsers.
export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [preferenceReady, setPreferenceReady] = useState(!LEGACY_GAMES_TAB_ENABLED);

  useEffect(() => {
    if (!LEGACY_GAMES_TAB_ENABLED || preferenceReady) return;
    let cancelled = false;

    getPreferredHomeTab()
      .then((tab) => {
        if (cancelled) return;
        if (pathname === "/" && tab === "games") {
          router.replace("/games");
          return;
        }
        setPreferenceReady(true);
      })
      .catch(() => {
        if (!cancelled) setPreferenceReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname, preferenceReady, router]);

  useEffect(() => {
    if (!LEGACY_GAMES_TAB_ENABLED || !preferenceReady) return;
    const tab = homeTabForPathname(pathname);
    if (!tab) return;
    setPreferredHomeTab(tab).catch(() => {});
  }, [pathname, preferenceReady]);

  const tabs = (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: tokens.bg.canvas },
        tabBarActiveTintColor: tokens.accent.default,
        tabBarInactiveTintColor: tokens.text.muted,
        // Bottom tab bar is hidden on every platform; the Lists / Games switch
        // lives in the top screen headers (InlineTabSwitch) instead.
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen
        name="games"
        options={
          LEGACY_GAMES_TAB_ENABLED
            ? {
                title: "Games",
                tabBarIcon: ({ color }) => <RNText style={{ color, fontSize: 17 }}>◆</RNText>,
              }
            : { href: null }
        }
      />
      <Tabs.Screen
        name="(lists)"
        options={{
          title: "Lists",
          tabBarIcon: ({ color }) => <RNText style={{ color, fontSize: 17 }}>◧</RNText>,
        }}
      />
    </Tabs>
  );

  return tabs;
}
