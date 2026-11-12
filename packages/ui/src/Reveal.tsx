import type { ReactNode } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { motionPresets } from "./motion";

export interface RevealProps {
  /**
   * Fade the content in as it mounts. Pass `useRevealAfterLoading(isPending)`
   * so only content that replaces a skeleton fades; cached content appears
   * at once.
   */
  when: boolean;
  children: ReactNode;
  /**
   * `flex: 1` (default), so the wrapper is layout-neutral in a screen body;
   * pass `false` inside scrolling content, where it should size to fit.
   */
  fill?: boolean;
  style?: ViewStyle;
}

/** Skeleton → content crossfade: the content fades in (`motion.fast`) over the gap. */
export function Reveal({ when, children, fill = true, style }: RevealProps) {
  return (
    <Animated.View
      entering={when ? motionPresets.reveal : undefined}
      style={[fill && styles.fill, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
