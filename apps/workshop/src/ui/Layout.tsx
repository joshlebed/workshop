import { usePathname, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { tokens } from "./theme";

const WEB_MAX_WIDTH = 560;

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

// Constrains a screen's content to a phone-sized reading column on web.
// On native the wrapper is a no-op flex:1 container; the device defines the
// width. On web, hands-on testing at 1920px showed full-bleed rows look
// broken — content clusters at the left edge and trailing affordances drift
// to the right. A 560px ceiling with `alignSelf: center` produces the same
// scannable column on every viewport.
export function Screen({ children, style, testID }: ScreenProps) {
  return (
    <View style={[styles.screen, style]} testID={testID}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

// The web counterpart of the native bottom tab bar: a slim left rail with
// the top-level Lists / Games switch. Rendered by `app/(tabs)/_layout.tsx`
// only on web with the Games flag on — native uses expo-router's tab bar,
// and with the flag off neither surface renders any switch.
export function SidebarTabSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const onGames = pathname === "/games" || pathname.startsWith("/games/");

  const item = (label: string, glyph: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      testID={`tab-switch-${label.toLowerCase()}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[sidebarStyles.item, active && { backgroundColor: tokens.accent.muted }]}
    >
      <Text style={{ color: active ? tokens.accent.default : tokens.text.muted, fontSize: 16 }}>
        {glyph}
      </Text>
      <Text
        variant="label"
        style={{ color: active ? tokens.accent.default : tokens.text.secondary }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[sidebarStyles.rail, { borderRightColor: tokens.bg.elevated }]}>
      {item("Lists", "◧", !onGames, () => router.navigate("/"))}
      {item("Games", "◆", onGames, () => router.navigate("/games"))}
    </View>
  );
}

const sidebarStyles = StyleSheet.create({
  rail: {
    width: 132,
    paddingTop: 24,
    paddingHorizontal: 8,
    gap: 4,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    ...Platform.select({
      web: { alignItems: "center" },
      default: {},
    }),
  },
  column: {
    flex: 1,
    width: "100%",
    ...Platform.select({
      web: { maxWidth: WEB_MAX_WIDTH },
      default: {},
    }),
  },
});

export const screenColumnMaxWidth = WEB_MAX_WIDTH;
