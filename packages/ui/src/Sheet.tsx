import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  Modal as RNModal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { focusFirstFocusable } from "./a11yFocus";
import { webAria } from "./interaction";
import { timing } from "./motion";
import { ToastOverlay } from "./Toast";
import { tokens } from "./theme";

export interface SheetProps {
  visible: boolean;
  onRequestClose: () => void;
  /**
   * Fires after the exit animation completes and the underlying RNModal has
   * unmounted. Use this to chain a follow-up Sheet — stacking two RNModals
   * on iOS while one is still dismissing leaves the screen non-interactable.
   */
  onClosed?: () => void;
  children: React.ReactNode;
  /** Style for the scrolling content container (padding, gap). */
  contentStyle?: ViewStyle;
  /** The dialog's accessible name (web `aria-label`): the sheet's title. */
  accessibilityLabel?: string;
  testID?: string;
}

// Enters at `slow`, leaves at `base`, both on the one ease-out curve. Under
// reduced motion the sheet fades in place instead of sliding up.
const SHEET_OFFSCREEN_PX = 600;

/**
 * Bottom sheet with Reanimated-driven enter/exit. The internal `rendered`
 * state delays unmount until the exit animation completes; otherwise RNModal
 * would tear the view down immediately on `visible={false}`.
 *
 * Capped at 85% of the screen with its content scrolling inside, so a tall
 * sheet never runs off the top. There is no drag handle: the sheet has no
 * pan-to-dismiss, so it doesn't draw an affordance that implies one. Dismiss
 * by tapping the backdrop, Escape / back, or the sheet's own controls.
 */
export function Sheet({
  visible,
  onRequestClose,
  onClosed,
  children,
  contentStyle,
  accessibilityLabel,
  testID,
}: SheetProps) {
  const sheetRef = useRef<ViewInstance>(null);
  // Web: react-native-web's Modal traps Tab and returns focus to the opener
  // on close, but it starts focus on the first node it can focus, which is
  // the backdrop. Move it to the sheet's first control instead.
  const focusSheet = useCallback(() => {
    if (Platform.OS !== "web") return;
    setTimeout(() => focusFirstFocusable(sheetRef.current), 30);
  }, []);
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  const reduceMotion = useReducedMotion();
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const handleExitComplete = useCallback(() => {
    setRendered(false);
    onClosedRef.current?.();
  }, []);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      progress.value = withTiming(1, timing("slow"));
      return;
    }
    progress.value = withTiming(0, timing("base"), (finished) => {
      if (finished) runOnJS(handleExitComplete)();
    });
  }, [visible, progress, handleExitComplete]);

  // Desktop web (5.7c): a sheet that slid up across a 1440px window read as
  // a phone artifact, so from `DIALOG_MIN_WIDTH` it is a centred dialog of
  // reading width that fades and rises a few pixels instead.
  const { width } = useWindowDimensions();
  const dialog = Platform.OS === "web" && width >= DIALOG_MIN_WIDTH;
  const offscreen = dialog ? DIALOG_RISE_PX : SHEET_OFFSCREEN_PX;

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheetStyle = useAnimatedStyle(() =>
    reduceMotion
      ? { opacity: progress.value, transform: [] }
      : {
          opacity: dialog ? progress.value : 1,
          transform: [{ translateY: (1 - progress.value) * offscreen }],
        },
  );

  return (
    <RNModal
      visible={rendered}
      onRequestClose={onRequestClose}
      transparent
      animationType="none"
      onShow={focusSheet}
      // react-native-web hands unknown props to the Modal's role="dialog"
      // node, so this names the dialog; native ignores it.
      {...webAria({ "aria-label": accessibilityLabel })}
      testID={testID}
    >
      <View style={styles.modalRoot}>
        <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.backdropPress}
          onPress={onRequestClose}
          // Pointer-only on web: Escape closes, and Tab stays in the sheet.
          tabIndex={-1}
        />
        <KeyboardAvoidingView
          pointerEvents="box-none"
          style={[styles.sheetHost, dialog && styles.dialogHost]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Animated.View
            pointerEvents="box-none"
            style={[styles.sheetFrame, dialog && styles.dialogFrame, sheetStyle]}
          >
            <ToastOverlay />
            <View
              ref={sheetRef}
              style={[styles.sheet, dialog && styles.dialog]}
              aria-modal
              accessibilityViewIsModal
            >
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={[styles.content, contentStyle]}
                keyboardShouldPersistTaps="handled"
                bounces={false}
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </RNModal>
  );
}

/** Window width from which a sheet presents as a centred dialog on web. */
const DIALOG_MIN_WIDTH = 720;
const DIALOG_MAX_WIDTH = 520;
const DIALOG_RISE_PX = 12;

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  backdropPress: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheetHost: {
    flex: 1,
    justifyContent: "flex-end",
    zIndex: 1,
  },
  sheetFrame: { maxHeight: "85%" },
  dialogHost: { justifyContent: "center", alignItems: "center", padding: tokens.space.xl },
  dialogFrame: { width: "100%", maxWidth: DIALOG_MAX_WIDTH },
  dialog: { borderRadius: tokens.radius.lg, borderWidth: 1 },
  sheet: {
    flexShrink: 1,
    backgroundColor: tokens.bg.surface,
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    borderColor: tokens.border.subtle,
    borderTopWidth: 1,
    overflow: "hidden",
  },
  scroll: { flexGrow: 0 },
  content: {
    paddingHorizontal: tokens.space.xl,
    paddingTop: tokens.space.xl,
    paddingBottom: tokens.space.xxl,
    gap: tokens.space.lg,
  },
});
