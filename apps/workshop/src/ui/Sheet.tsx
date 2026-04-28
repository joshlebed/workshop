import { useEffect, useState } from "react";
import { Pressable, Modal as RNModal, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { tokens } from "./theme";

export interface SheetProps {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  testID?: string;
}

const ENTER_DURATION_MS = 280;
const EXIT_DURATION_MS = 220;
const SHEET_OFFSCREEN_PX = 600;

/**
 * Bottom sheet with Reanimated-driven enter/exit. The internal `rendered`
 * state delays unmount until the exit animation completes; otherwise RNModal
 * would tear the view down immediately on `visible={false}`.
 */
export function Sheet({ visible, onRequestClose, children, contentStyle, testID }: SheetProps) {
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      progress.value = withTiming(1, {
        duration: ENTER_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    progress.value = withTiming(
      0,
      { duration: EXIT_DURATION_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setRendered)(false);
      },
    );
  }, [visible, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * SHEET_OFFSCREEN_PX }],
  }));

  return (
    <RNModal
      visible={rendered}
      onRequestClose={onRequestClose}
      transparent
      animationType="none"
      testID={testID}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
          style={styles.backdropPress}
          onPress={onRequestClose}
        >
          <Animated.View style={sheetStyle}>
            <Pressable
              accessibilityRole="none"
              onPress={(e) => e.stopPropagation()}
              style={[styles.sheet, contentStyle]}
            >
              <View style={styles.handle} />
              {children}
            </Pressable>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  backdropPress: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: tokens.bg.surface,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    borderColor: tokens.border.subtle,
    borderTopWidth: 1,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.border.strong,
  },
});
