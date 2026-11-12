import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { tokens } from "./theme";

const WEB_MAX_WIDTH = 560;

/**
 * Page layout constants (UX pass 5.4). One horizontal gutter on every screen:
 * 16, which is also where a `ListRow`'s content starts (4 margin + 12
 * padding), so text in a padded block lines up with text in a row. One
 * vertical rhythm for section headers: 24 above, 4 below.
 */
export const layout = {
  /** The one horizontal page gutter. */
  gutter: tokens.space.lg,
  /** Space above a `SectionHeader` that follows content. */
  sectionTop: tokens.space.xl,
  /** Space between a `SectionHeader` and its first row. */
  sectionBottom: tokens.space.xs,
  /** Gap under the header before the first content. */
  contentTopGap: tokens.space.xs,
  /** Clearance at the end of a scrolling list (clears the FAB). */
  bottomInset: tokens.space.xxl * 2,
  /** The reading column on web. */
  columnMaxWidth: WEB_MAX_WIDTH,
} as const;

/** @deprecated Use `layout`. Kept for older call sites. */
export const homeLayout = {
  horizontalInset: layout.gutter,
  contentTopGap: layout.contentTopGap,
  bottomInset: layout.bottomInset,
} as const;

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
  /**
   * Floating chrome pinned to the reading column (a `Fab`). On web the
   * column is centred in the window, so a FAB placed in the full-width
   * screen would drift to the window edge.
   */
  overlay?: ReactNode;
}

interface HomeHeaderProps {
  left?: ReactNode;
  right?: ReactNode;
  testID?: string;
}

/**
 * The reading column on web: full width up to `layout.columnMaxWidth`,
 * centred. Native gets nothing (the device defines the width). Apply it to a
 * scroll view's `contentContainerStyle`, or use `ScreenColumn` for a block
 * that doesn't scroll.
 */
export const screenColumnStyle: ViewStyle = Platform.select<ViewStyle>({
  web: { width: "100%", maxWidth: WEB_MAX_WIDTH, alignSelf: "center" },
  default: {},
});

/**
 * A screen (UX pass 5.7a). On web the screen is the full width of its pane
 * and the page scrolls there: a screen's scroll view spans the whole pane so
 * its scrollbar sits at the window edge and the wheel works anywhere, with
 * the content held to the reading column by `screenColumnStyle`
 * (`ScreenHeader` applies it to itself). Before this, the scroll box was the
 * 560px column, an inner box with its own scrollbar in the middle of the
 * page. On native the wrapper is a plain flex:1 container.
 */
export function Screen({ children, style, testID, overlay }: ScreenProps) {
  return (
    <View style={[styles.screen, style]} testID={testID}>
      {children}
      {overlay ? (
        <View pointerEvents="box-none" style={styles.overlayHost}>
          <View pointerEvents="box-none" style={[styles.overlayColumn, screenColumnStyle]}>
            {overlay}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** A non-scrolling block held to the reading column on web (a footer, a banner). */
export function ScreenColumn({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[screenColumnStyle, style]}>{children}</View>;
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
  screen: { flex: 1 },
  overlayHost: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  overlayColumn: { flex: 1 },
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
