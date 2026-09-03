import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { tokens } from "./tokens";

// HighScore is a phone app on both platforms. On web the canvas is pinned to a
// phone-width column rather than the wider reading column Workshop uses — the
// matrix is designed for a 390pt viewport and stretching it edge-to-edge would
// spread the score grid into unreadable whitespace.
const WEB_MAX_WIDTH = 420;

export const layout = {
  /** Content inset. Matches the 16 step so cells align to the same gutter. */
  inset: tokens.space.md,
  /** Bottom key-panel height (excludes the safe-area inset it sits on). */
  keyPanelHeight: 52,
} as const;

interface ScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
}

/**
 * Constrains a screen's content to a phone-width column on web (a flex:1
 * wrapper on native). Every top-level route wraps in this.
 */
export function Screen({ children, style, testID }: ScreenProps) {
  return (
    <View style={[styles.screen, style]} testID={testID}>
      <View style={styles.column}>{children}</View>
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
});

export const screenColumnMaxWidth = WEB_MAX_WIDTH;
