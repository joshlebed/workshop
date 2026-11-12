import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { copyToClipboard } from "./clipboard";
import { Icon } from "./Icon";
import { interaction, type PressState } from "./interaction";
import { Text } from "./Text";
import { tokens } from "./theme";

type ToastTone = "default" | "success" | "danger";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  key?: string;
  /** Set when dismissed; the row plays its exit before it is removed. */
  leaving?: boolean;
}

interface ShowToastInput {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Toasts that share a key replace each other instead of stacking: ticking
   * off five rows in a row leaves one "Marked done · Undo", for the latest.
   */
  key?: string;
}

interface ToastContextValue {
  showToast: (input: ShowToastInput) => void;
  /**
   * Lift the toast viewport by `px` while the caller is mounted (a screen
   * with a bottom bar the toasts would otherwise cover). Returns the
   * unregister function; the viewport honours the largest active lift.
   */
  registerBottomInset: (px: number) => () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Non-throwing access for shared primitives (`Fab`) that work without a provider. */
export function useOptionalToast(): ToastContextValue | null {
  return useContext(ToastContext);
}

// Separate from ToastContext so `useToast()` callers don't re-render on every
// toast. Read by `ToastOverlay` to re-host the toasts inside an RN `Modal`.
interface ToastStateContextValue {
  toasts: Toast[];
  dismiss: (id: number) => void;
  registerOverlay: () => () => void;
}

const ToastStateContext = createContext<ToastStateContextValue | null>(null);

// Default toasts auto-dismiss after a short read. Danger toasts hang around
// 10s because the user usually needs them long enough to copy the message
// and report it.
const DEFAULT_DURATION_MS = 3500;
const DANGER_DURATION_MS = 10_000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [overlayCount, setOverlayCount] = useState(0);
  const [bottomInsets, setBottomInsets] = useState<{ id: number; px: number }[]>([]);
  const idRef = useRef(0);
  const insetIdRef = useRef(0);

  const registerBottomInset = useCallback((px: number) => {
    insetIdRef.current += 1;
    const id = insetIdRef.current;
    setBottomInsets((prev) => [...prev, { id, px }]);
    return () => setBottomInsets((prev) => prev.filter((i) => i.id !== id));
  }, []);
  const bottomInset = bottomInsets.reduce((max, i) => Math.max(max, i.px), 0);

  const registerOverlay = useCallback(() => {
    setOverlayCount((n) => n + 1);
    return () => setOverlayCount((n) => n - 1);
  }, []);

  // Dismiss marks the toast as leaving so it can play its exit, then drops
  // it once the exit (`motion.fast`) has run.
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, tokens.motion.fast);
  }, []);

  const showToast = useCallback(
    ({ message, tone = "default", durationMs, actionLabel, onAction, key }: ShowToastInput) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => [
        ...(key ? prev.filter((t) => t.key !== key) : prev),
        { id, message, tone, actionLabel, onAction, key },
      ]);
      const effectiveDuration =
        durationMs ?? (tone === "danger" ? DANGER_DURATION_MS : DEFAULT_DURATION_MS);
      if (effectiveDuration > 0) {
        setTimeout(() => dismiss(id), effectiveDuration);
      }
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({ showToast, registerBottomInset }),
    [showToast, registerBottomInset],
  );
  const stateValue = useMemo(
    () => ({ toasts, dismiss, registerOverlay }),
    [toasts, dismiss, registerOverlay],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastStateContext.Provider value={stateValue}>
        {children}
        {overlayCount === 0 ? (
          <ToastViewport
            toasts={toasts}
            dismiss={dismiss}
            style={[styles.viewport, { bottom: tokens.space.xl + bottomInset }]}
          />
        ) : null}
      </ToastStateContext.Provider>
    </ToastContext.Provider>
  );
}

/**
 * Hosts the toasts inside an RN `Modal` (see `Sheet`). A `Modal` presents
 * above the root view, so the provider's own viewport would be hidden behind
 * it; while an overlay is mounted the provider yields to it. Renders in flow,
 * so the parent decides where the toasts sit.
 */
export function ToastOverlay() {
  const state = useContext(ToastStateContext);
  const registerOverlay = state?.registerOverlay;
  useEffect(() => registerOverlay?.(), [registerOverlay]);
  if (!state) return null;
  return <ToastViewport toasts={state.toasts} dismiss={state.dismiss} style={styles.overlay} />;
}

function ToastViewport({
  toasts,
  dismiss,
  style,
}: {
  toasts: Toast[];
  dismiss: (id: number) => void;
  style: StyleProp<ViewStyle>;
}) {
  if (toasts.length === 0) return null;
  return (
    <View pointerEvents="box-none" style={style}>
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </View>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = toneStyle[toast.tone];
  const showCopy = toast.tone === "danger";
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const leaving = !!toast.leaving;
  useEffect(() => {
    progress.value = leaving
      ? withTiming(0, { duration: tokens.motion.fast, easing: Easing.in(Easing.cubic) })
      : withTiming(1, {
          duration: tokens.motion.base,
          easing: Easing.bezier(...tokens.motion.easeOut),
        });
  }, [leaving, progress]);
  const motionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * 12 }],
  }));
  const isAlert = toast.tone === "danger";
  return (
    <Animated.View
      style={[styles.row, tone, motionStyle]}
      testID={`toast-${toast.tone}`}
      // A live region: polite status for confirmations, assertive alert for
      // failures, so screen readers announce toasts without moving focus.
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
    >
      <Text style={styles.message} selectable>
        {toast.message}
      </Text>
      {toast.actionLabel ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            toast.onAction?.();
            onDismiss();
          }}
          style={({ pressed, hovered }: PressState) => [
            styles.action,
            hovered && styles.iconBtnHover,
            pressed && styles.iconBtnPressed,
          ]}
          testID="toast-action"
        >
          <Text style={styles.actionLabel}>{toast.actionLabel}</Text>
        </Pressable>
      ) : null}
      {showCopy ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy error message"
          onPress={() => {
            copyToClipboard(toast.message).catch(() => {});
          }}
          style={({ pressed, hovered }: PressState) => [
            styles.iconBtn,
            hovered && styles.iconBtnHover,
            pressed && styles.iconBtnPressed,
          ]}
          testID="toast-copy"
        >
          <Icon name="copy" size={16} tone="secondary" />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        style={({ pressed, hovered }: PressState) => [
          styles.iconBtn,
          hovered && styles.iconBtnHover,
          pressed && styles.iconBtnPressed,
        ]}
        testID="toast-dismiss"
      >
        <Icon name="close" size={14} tone="secondary" />
      </Pressable>
    </Animated.View>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const toneStyle = {
  default: { backgroundColor: tokens.bg.elevated, borderColor: tokens.border.default },
  success: { backgroundColor: tokens.bg.elevated, borderColor: tokens.status.success },
  danger: { backgroundColor: tokens.bg.elevated, borderColor: tokens.status.danger },
} as const;

const styles = StyleSheet.create({
  viewport: {
    position: "absolute",
    bottom: tokens.space.xl,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
  },
  overlay: {
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingBottom: tokens.space.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    paddingLeft: tokens.space.lg,
    paddingRight: tokens.space.xs,
    paddingVertical: tokens.space.xs,
    minHeight: 52,
    maxWidth: 480,
    width: "100%",
  },
  message: { flex: 1, color: tokens.text.primary, fontSize: tokens.font.size.sm },
  // A text action in the accent, not a filled button: an Undo follows every
  // tick, so it has to stay quiet until it is wanted.
  action: {
    paddingHorizontal: tokens.space.md,
    minHeight: tokens.hit,
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  actionLabel: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.accent.default,
  },
  iconBtn: {
    width: tokens.hit,
    height: tokens.hit,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  iconBtnHover: { backgroundColor: interaction.hover },
  iconBtnPressed: { backgroundColor: interaction.pressed },
});
