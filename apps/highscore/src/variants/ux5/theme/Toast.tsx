// HighScore-owned toast system — same API as the shared `@workshop/ui`
// ToastProvider/useToast, restyled: surface.2 fill, sharp corners, 2px bezel
// that lights up in the tone color, pixel close/copy icons.
import { copyToClipboard } from "@workshop/ui/clipboard";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { PixelIcon } from "./PixelIcon";
import { Text } from "./Text";
import { tokens } from "./tokens";

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

// Danger toasts hang around long enough to copy the message and report it.
const DEFAULT_DURATION_MS = 3500;
const DANGER_DURATION_MS = 10_000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

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

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <View style={styles.viewport}>
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
          style={({ pressed, hovered }) => [
            styles.iconBtn,
            (pressed || hovered) && styles.iconBtnHover,
          ]}
          hitSlop={8}
          testID="toast-copy"
        >
          <PixelIcon name="copy" size={16} color={tokens.text.secondary} />
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
        <PixelIcon name="close" size={16} color={tokens.text.secondary} />
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
  default: { borderColor: tokens.border.default },
  success: { borderColor: tokens.neon.chartreuse },
  danger: { borderColor: tokens.status.danger },
} as const;

const styles = StyleSheet.create({
  viewport: {
    pointerEvents: "box-none",
    position: "absolute",
    bottom: tokens.space.xl,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.sm,
    backgroundColor: tokens.bg.elevated,
    borderRadius: 0,
    borderWidth: tokens.bezel,
    paddingLeft: tokens.space.lg,
    paddingRight: tokens.space.sm,
    paddingVertical: tokens.space.sm,
    minHeight: 44,
    maxWidth: 480,
    width: "100%",
  },
  message: { flex: 1, color: tokens.text.primary, fontSize: tokens.font.size.sm },
  // Outline "lit sign" action, matching the primary Button treatment.
  action: {
    borderWidth: tokens.bezel,
    borderColor: tokens.neon.pink,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs,
    borderRadius: 0,
  },
  actionLabel: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    color: tokens.neon.pinkTint,
  },
  iconBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 0,
  },
  iconBtnHover: { backgroundColor: tokens.bg.raised },
});
