import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { CopyIcon } from "./CopyIcon";
import { copyToClipboard } from "./clipboard";
import { Text } from "./Text";
import { tokens } from "./theme";

type ToastTone = "default" | "success" | "danger";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

interface ShowToastInput {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  showToast: (input: ShowToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

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
  const idRef = useRef(0);

  const registerOverlay = useCallback(() => {
    setOverlayCount((n) => n + 1);
    return () => setOverlayCount((n) => n - 1);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, tone = "default", durationMs, actionLabel, onAction }: ShowToastInput) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => [...prev, { id, message, tone, actionLabel, onAction }]);
      const effectiveDuration =
        durationMs ?? (tone === "danger" ? DANGER_DURATION_MS : DEFAULT_DURATION_MS);
      if (effectiveDuration > 0) {
        setTimeout(() => dismiss(id), effectiveDuration);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);
  const stateValue = useMemo(
    () => ({ toasts, dismiss, registerOverlay }),
    [toasts, dismiss, registerOverlay],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastStateContext.Provider value={stateValue}>
        {children}
        {overlayCount === 0 ? (
          <ToastViewport toasts={toasts} dismiss={dismiss} style={styles.viewport} />
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
  style: ViewStyle;
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
  return (
    <View style={[styles.row, tone]} testID={`toast-${toast.tone}`}>
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
          style={styles.action}
        >
          <Text style={styles.actionLabel} tone="onAccent">
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
          style={({ pressed, hovered }) => [
            styles.iconBtn,
            (pressed || hovered) && styles.iconBtnHover,
          ]}
          hitSlop={8}
          testID="toast-copy"
        >
          <CopyIcon size={14} color={tokens.text.secondary} />
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={onDismiss}
        style={({ pressed, hovered }) => [
          styles.iconBtn,
          (pressed || hovered) && styles.iconBtnHover,
        ]}
        hitSlop={8}
        testID="toast-dismiss"
      >
        <Text style={styles.iconGlyph}>✕</Text>
      </Pressable>
    </View>
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
    paddingRight: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    minHeight: 44,
    maxWidth: 480,
    width: "100%",
  },
  message: { flex: 1, color: tokens.text.primary, fontSize: tokens.font.size.sm },
  action: {
    backgroundColor: tokens.accent.default,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: tokens.radius.sm,
  },
  actionLabel: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold },
  iconBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: tokens.radius.sm,
  },
  iconBtnHover: { backgroundColor: tokens.bg.surface },
  iconGlyph: {
    color: tokens.text.secondary,
    fontSize: tokens.font.size.md,
    lineHeight: tokens.font.size.md + 2,
  },
});
