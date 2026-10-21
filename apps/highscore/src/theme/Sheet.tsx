// HighScore-owned Sheet: same keyboard/animation machinery as the shared
// `@workshop/ui` Sheet (backdrop close target stays a sibling behind the
// content — see the Sheet note in the root CLAUDE.md), restyled to the
// Neon Signage spec: surface.2 fill, sharp corners, 2px purple bezel.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  Modal as RNModal,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { tokens } from "./tokens";

export interface SheetProps {
  visible: boolean;
  onRequestClose: () => void;
  /** Fires after the exit animation completes — chain follow-up Sheets here. */
  onClosed?: () => void;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  testID?: string;
}

const ENTER_DURATION_MS = 280;
const EXIT_DURATION_MS = 220;
const SHEET_OFFSCREEN_PX = 600;

export function Sheet({
  visible,
  onRequestClose,
  onClosed,
  children,
  contentStyle,
  testID,
}: SheetProps) {
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const handleExitComplete = useCallback(() => {
    setRendered(false);
    onClosedRef.current?.();
  }, []);

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
        if (finished) runOnJS(handleExitComplete)();
      },
    );
  }, [visible, progress, handleExitComplete]);

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
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.backdrop, styles.noHits, backdropStyle]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
          style={styles.backdropPress}
          onPress={onRequestClose}
        />
        <KeyboardAvoidingView
          style={styles.sheetHost}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Animated.View style={[styles.passThrough, sheetStyle]}>
            <View style={[styles.sheet, contentStyle]}>
              <View style={styles.handle} />
              {children}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetHost: {
    flex: 1,
    justifyContent: "flex-end",
    zIndex: 1,
    pointerEvents: "box-none",
  },
  passThrough: { pointerEvents: "box-none" },
  noHits: { pointerEvents: "none" },
  sheet: {
    backgroundColor: tokens.bg.elevated,
    borderRadius: 0,
    borderColor: tokens.border.default,
    borderTopWidth: tokens.bezel,
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.md,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
  handle: {
    alignSelf: "center",
    width: 32,
    height: 4,
    borderRadius: 0,
    backgroundColor: tokens.border.default,
  },
});
