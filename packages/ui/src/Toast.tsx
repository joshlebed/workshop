import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { copyToClipboard } from "./clipboard";
import { Icon } from "./Icon";
import { interaction, type PressState } from "./interaction";
import { motionPresets, timing } from "./motion";
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
  /** `Date.now()` when raised; `dismissForNavigation` keeps the newest. */
  createdAt: number;
  /** Set when dismissed; the row plays its exit before it is removed. */
  leaving?: boolean;
}

/**
 * A toast raised within this window before a navigation belongs to the
 * destination ("Added to Movies" after the share picker lands on the list,
 * "Deleted · Undo" after item detail goes back), so it survives it.
 */
const NAVIGATION_GRACE_MS = 600;

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
  /**
   * The navigation rule (UX pass 5, review carry-over 3): a toast belongs to
   * the screen that raised it, so opening another screen on top dismisses
   * it. Call when a new screen is opened (not on back, which returns to the
   * toast's own screen). Toasts raised in the last `NAVIGATION_GRACE_MS`
   * were raised by the navigation itself and stay.
   */
  dismissForNavigation: () => void;
  /**
   * Dismiss the toast with this key, if one is showing. A write that fails
   * takes back its optimistic "Marked done · Undo" before the failure shows.
   */
  dismissKey: (key: string) => void;
  /**
   * Run the newest visible toast's action (its Undo) and dismiss it. Returns
   * false when no toast offers one. For a keyboard shortcut: the toast's own
   * button sits at the end of the tab order and leaves in a few seconds.
   */
  runLatestAction: (actionLabel?: string) => boolean;
  /**
   * Say something to screen readers without a visible toast (a row moved by
   * Move up / Move down, whose result is visible already).
   */
  announce: (message: string) => void;
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
  /** Hold / restart a toast's auto-dismiss while the pointer or focus is on it. */
  hold: (id: number, held: boolean) => void;
  announcement: Announcement;
}

/** What the screen-reader live region says now (`n` re-announces a repeat). */
interface Announcement {
  text: string;
  assertive: boolean;
  n: number;
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
  // Auto-dismiss timers, held while the pointer or keyboard focus is on the
  // toast (WCAG 2.2.1) and restarted with the full duration when it leaves.
  const timersRef = useRef(
    new Map<number, { ms: number; handle: ReturnType<typeof setTimeout> | null }>(),
  );
  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer?.handle) clearTimeout(timer.handle);
    timersRef.current.delete(id);
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
        { id, message, tone, actionLabel, onAction, key, createdAt: Date.now() },
      ]);
      const effectiveDuration =
        durationMs ?? (tone === "danger" ? DANGER_DURATION_MS : DEFAULT_DURATION_MS);
      if (effectiveDuration > 0) {
        timersRef.current.set(id, {
          ms: effectiveDuration,
          handle: setTimeout(() => dismiss(id), effectiveDuration),
        });
      }
      // Screen readers: one persistent live region per host says it (a
      // region inserted together with its text is often not read), and
      // native announces it directly (iOS has no live regions).
      const sentence = /[.!?…]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`;
      const spoken = actionLabel ? `${sentence} ${actionLabel} available.` : message;
      setAnnouncement((prev) => ({ text: spoken, assertive: tone === "danger", n: prev.n + 1 }));
      if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(spoken);
    },
    [dismiss],
  );

  const hold = useCallback(
    (id: number, held: boolean) => {
      const t = timersRef.current.get(id);
      if (!t) return;
      if (t.handle) clearTimeout(t.handle);
      t.handle = held ? null : setTimeout(() => dismiss(id), t.ms);
    },
    [dismiss],
  );
  const [announcement, setAnnouncement] = useState<Announcement>({
    text: "",
    assertive: false,
    n: 0,
  });

  const toastsRef = useRef<Toast[]>([]);
  toastsRef.current = toasts;
  const dismissForNavigation = useCallback(() => {
    const cutoff = Date.now() - NAVIGATION_GRACE_MS;
    for (const t of toastsRef.current) {
      if (!t.leaving && t.createdAt < cutoff) dismiss(t.id);
    }
  }, [dismiss]);

  const announce = useCallback((message: string) => {
    setAnnouncement((prev) => ({ text: message, assertive: false, n: prev.n + 1 }));
    if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const runLatestAction = useCallback(
    (actionLabel?: string) => {
      const latest = [...toastsRef.current]
        .reverse()
        .find((t) => !t.leaving && t.onAction && (!actionLabel || t.actionLabel === actionLabel));
      if (!latest) return false;
      latest.onAction?.();
      dismiss(latest.id);
      return true;
    },
    [dismiss],
  );

  const dismissKey = useCallback(
    (key: string) => {
      for (const t of toastsRef.current) if (t.key === key && !t.leaving) dismiss(t.id);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      showToast,
      registerBottomInset,
      dismissForNavigation,
      dismissKey,
      runLatestAction,
      announce,
    }),
    [showToast, registerBottomInset, dismissForNavigation, dismissKey, runLatestAction, announce],
  );
  const stateValue = useMemo(
    () => ({ toasts, dismiss, registerOverlay, hold, announcement }),
    [toasts, dismiss, registerOverlay, hold, announcement],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastStateContext.Provider value={stateValue}>
        {children}
        {overlayCount === 0 ? <ToastAnnouncer announcement={announcement} /> : null}
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
  return (
    <>
      <ToastAnnouncer announcement={state.announcement} />
      <ToastViewport toasts={state.toasts} dismiss={state.dismiss} style={styles.overlay} />
    </>
  );
}

/**
 * Web: two always-mounted, visually hidden live regions (polite status,
 * assertive alert). The text is set a tick after the region is cleared so a
 * repeated message ("Marked done" twice) is read again. Native announces from
 * `showToast` instead.
 */
function ToastAnnouncer({ announcement }: { announcement: Announcement }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!announcement.text) return;
    setText("");
    const t = setTimeout(() => setText(announcement.text), 50);
    return () => clearTimeout(t);
  }, [announcement]);
  if (Platform.OS !== "web") return null;
  return (
    <>
      <View role="status" aria-live="polite" style={styles.srOnly}>
        <Text>{announcement.assertive ? "" : text}</Text>
      </View>
      <View role="alert" aria-live="assertive" style={styles.srOnly}>
        <Text>{announcement.assertive ? text : ""}</Text>
      </View>
    </>
  );
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
    // Rises 12px and fades in at `base`; fades back out at `fast` (the
    // provider removes it after `fast`). Reduced motion: the fade only.
    progress.value = withTiming(leaving ? 0 : 1, timing(leaving ? "fast" : "base"));
  }, [leaving, progress]);
  const motionStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: reduceMotion ? [] : [{ translateY: (1 - progress.value) * 12 }],
  }));
  const hold = useContext(ToastStateContext)?.hold;
  // Web: where keyboard focus came from, to hand it back when the toast
  // goes (Undo or Dismiss would otherwise leave focus on <body>).
  const cameFromRef = useRef<HTMLElement | null>(null);
  const holdHandlers = (
    Platform.OS === "web"
      ? {
          onMouseEnter: () => hold?.(toast.id, true),
          onMouseLeave: () => hold?.(toast.id, false),
          onFocus: (e: { relatedTarget?: unknown; currentTarget?: unknown }) => {
            hold?.(toast.id, true);
            const from = e.relatedTarget as HTMLElement | null | undefined;
            const row = e.currentTarget as HTMLElement | undefined;
            if (from && !row?.contains(from)) cameFromRef.current = from;
          },
          onBlur: () => hold?.(toast.id, false),
        }
      : {}
  ) as object;
  const leave = () => {
    onDismiss();
    const back = cameFromRef.current;
    if (!back || typeof document === "undefined") return;
    // Watch for a moment: the action re-renders the screen (Undo puts a row
    // back) and can drop focus more than once.
    let ticks = 0;
    const settle = () => {
      const now = document.activeElement;
      if (!now || now === document.body || !document.contains(now)) {
        // The same control may have re-rendered as a new node (a row that
        // moved section): find it again by its test id.
        const id = back.dataset?.testid;
        const target = document.contains(back)
          ? back
          : id
            ? document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
            : null;
        target?.focus();
      }
      ticks += 1;
      if (ticks < 20) setTimeout(settle, 50);
    };
    setTimeout(settle, tokens.motion.fast);
  };
  return (
    <Animated.View
      // A stacked toast slides into the gap one above it leaves.
      layout={motionPresets.move}
      style={[styles.row, tone, motionStyle]}
      testID={`toast-${toast.tone}`}
      // Announced through `ToastAnnouncer`'s live regions, not here (a region
      // mounted with its text is often skipped, and two would read twice).
      // Pointer or focus on the toast holds its auto-dismiss.
      {...holdHandlers}
    >
      <Text variant="label" style={styles.message} selectable>
        {toast.message}
      </Text>
      {toast.actionLabel ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            toast.onAction?.();
            leave();
          }}
          style={({ pressed, hovered }: PressState) => [
            styles.action,
            hovered && styles.iconBtnHover,
            pressed && styles.iconBtnPressed,
          ]}
          testID="toast-action"
        >
          <Text variant="label" style={styles.actionLabel}>
            {toast.actionLabel}
          </Text>
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
        onPress={leave}
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
  // Visually hidden, still read (the usual sr-only clip).
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    margin: -1,
    padding: 0,
    overflow: "hidden",
    borderWidth: 0,
  },
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
  message: { flex: 1, color: tokens.text.primary, fontWeight: tokens.font.weight.regular },
  // A text action in the accent, not a filled button: an Undo follows every
  // tick, so it has to stay quiet until it is wanted.
  action: {
    paddingHorizontal: tokens.space.md,
    minHeight: tokens.hit,
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  actionLabel: {
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
