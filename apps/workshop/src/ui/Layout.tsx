import { usePathname, useRouter } from "expo-router";
import type { ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
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

// The web counterpart of the native bottom tab bar: a compact inline switch
// for Lists / Games. Render it inside top-level screen headers only on web
// with the Games flag on — native uses expo-router's tab bar, and with the
// flag off neither surface renders any switch.
export function InlineTabSwitch() {
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const onGames = pathname === "/games" || pathname.startsWith("/games/");
  const compact = Platform.OS === "web" && width < 360;

  const item = (label: string, glyph: string, active: boolean, onPress: () => void) => (
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
        style={[topTabStyles.glyph, { color: active ? tokens.accent.default : tokens.text.muted }]}
      >
        {glyph}
      </Text>
      {compact ? null : (
        <Text
          variant="label"
          style={[
            topTabStyles.label,
            { color: active ? tokens.accent.default : tokens.text.secondary },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );

  return (
    <View style={topTabStyles.track}>
      {item("Lists", "◧", !onGames, () => router.navigate("/"))}
      {item("Games", "◆", onGames, () => router.navigate("/games"))}
    </View>
  );
}

const topTabStyles = StyleSheet.create({
  track: {
    flexDirection: "row",
    gap: tokens.space.xs,
    padding: 3,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.bg.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.border.subtle,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: tokens.space.md,
    borderRadius: tokens.radius.pill,
  },
  itemActive: { backgroundColor: tokens.accent.muted },
  itemHover: { backgroundColor: tokens.bg.elevated },
  glyph: { fontSize: 14, lineHeight: 18 },
  label: { fontWeight: tokens.font.weight.semibold },
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
