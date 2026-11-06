import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { tokens } from "./tokens";

// Same reading-column width as the shared `@workshop/ui` Screen so the
// restyle changes nothing about where content sits.
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

/**
 * A header icon button's box: 44px wide when there's room, squeezing to the
 * icon (`minWidth`) on narrow screens before the icon row wraps under the
 * wordmark. Spread into every control in `HomeHeader`'s `right`.
 */
export const homeHeaderIcon = {
  flexBasis: 44,
  flexShrink: 1,
  minWidth: 28,
  height: 40,
  alignItems: "center",
  justifyContent: "center",
} as const;

interface HomeHeaderProps {
  left?: ReactNode;
  right?: ReactNode;
  /**
   * The icon row's narrowest width (sum of its controls' `minWidth`s). Below
   * this, the row drops onto its own line instead of overlapping the wordmark.
   */
  rightMinWidth?: number;
  testID?: string;
}

/** Phone-shaped reading column on web; a no-op flex wrapper on native. */
export function Screen({ children, style, testID }: ScreenProps) {
  return (
    <View style={[styles.screen, style]} testID={testID}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

// Wordmark on the left at its natural width; the icon row takes the rest,
// its buttons squeezing toward their icons as space runs out, and wraps to a
// second line (right-aligned) once even the squeezed row doesn't fit.
export function HomeHeader({ left, right, rightMinWidth = 0, testID }: HomeHeaderProps) {
  return (
    <View style={styles.homeHeader} testID={testID}>
      <View style={styles.homeHeaderLeft}>{left}</View>
      {right ? (
        <View style={[styles.homeHeaderRight, { minWidth: rightMinWidth }]}>{right}</View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: tokens.bg.canvas,
    ...Platform.select({ web: { alignItems: "center" }, default: {} }),
  },
  column: {
    flex: 1,
    width: "100%",
    ...Platform.select({ web: { maxWidth: WEB_MAX_WIDTH }, default: {} }),
  },
  homeHeader: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: tokens.space.md,
    rowGap: tokens.space.xs,
    paddingHorizontal: homeLayout.horizontalInset,
    paddingTop: tokens.space.sm,
    paddingBottom: tokens.space.md,
  },
  homeHeaderLeft: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  homeHeaderRight: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
});
