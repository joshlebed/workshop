import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
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
