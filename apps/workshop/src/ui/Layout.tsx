import { usePathname, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./Text";
import { tokens } from "./theme";

const WEB_MAX_WIDTH = 560;

export const homeLayout = {
  horizontalInset: tokens.space.lg,
  contentTopGap: tokens.space.xs,
  bottomInset: tokens.space.xxl * 2,
} as const;

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

interface HomeHeaderProps {
  left?: ReactNode;
  right?: ReactNode;
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

export function HomeHeader({ left, right, testID }: HomeHeaderProps) {
  return (
    <View style={styles.homeHeader} testID={testID}>
      <View style={styles.homeHeaderLeft}>{left}</View>
      {right ? <View style={styles.homeHeaderRight}>{right}</View> : null}
    </View>
  );
}

// The web counterpart of the native bottom tab bar: a compact inline switch
// for Lists / Games. Render it inside top-level screen headers only on web
// with the Games flag on — native uses expo-router's tab bar, and with the
// flag off neither surface renders any switch.
export function InlineTabSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const onGames = pathname === "/games" || pathname.startsWith("/games/");

  const item = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      testID={`tab-switch-${label.toLowerCase()}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        topTabStyles.item,
        active && topTabStyles.itemActive,
        (pressed || hovered) && !active && topTabStyles.itemHover,
      ]}
    >
      <Text
        variant="label"
        style={[
          topTabStyles.label,
          { color: active ? tokens.text.primary : tokens.text.secondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={topTabStyles.track}>
      {item("Lists", !onGames, () => router.navigate("/"))}
      {item("Games", onGames, () => router.navigate("/games"))}
    </View>
  );
}

const topTabStyles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.md,
    minHeight: 40,
  },
  item: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: tokens.space.sm,
    borderRadius: tokens.radius.sm,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  itemActive: { borderBottomColor: tokens.accent.default },
  itemHover: { backgroundColor: tokens.bg.surface },
  label: { fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.semibold },
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
  homeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space.md,
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  homeHeaderLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  homeHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
  },
});

export const screenColumnMaxWidth = WEB_MAX_WIDTH;
