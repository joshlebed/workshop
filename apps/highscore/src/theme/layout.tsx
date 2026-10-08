import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { deck, tokens } from "./tokens";

/** Phone-shaped reading column on web; a no-op flex wrapper on native. */
const WEB_MAX_WIDTH = 440;

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

export function Screen({ children, style, testID }: ScreenProps) {
  return (
    <View style={[styles.screen, style]} testID={testID}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

/**
 * One row on the app's asymmetric grid: a fixed marker column on the left,
 * content on the right. `rule` draws the vertical bezel between them — set it
 * only when the marker column actually carries something.
 */
export function GutterRow({
  marker,
  children,
  rule = false,
  style,
  testID,
}: {
  marker?: ReactNode;
  children: ReactNode;
  rule?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  return (
    <View style={[styles.gutterRow, style]} testID={testID}>
      <View style={[styles.marker, rule && styles.markerRule]}>{marker}</View>
      <View style={styles.gutterContent}>{children}</View>
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
  gutterRow: { flexDirection: "row", alignItems: "stretch" },
  marker: {
    width: deck.gutter,
    paddingLeft: tokens.space.lg,
    paddingRight: tokens.space.md,
    paddingTop: 2,
  },
  markerRule: {
    borderRightWidth: tokens.bezel,
    borderRightColor: tokens.border.default,
  },
  gutterContent: {
    flex: 1,
    minWidth: 0,
    paddingLeft: tokens.space.md,
    paddingRight: tokens.space.lg,
  },
});

export const screenColumnMaxWidth = WEB_MAX_WIDTH;
