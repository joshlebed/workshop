import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { tokens } from "./tokens";

/** Phone-shaped reading column on web; a no-op flex wrapper on native. */
const WEB_MAX_WIDTH = 480;

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
