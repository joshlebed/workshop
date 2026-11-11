import { Alert, Platform } from "react-native";
import { type ConfirmOptions, confirmStore } from "./confirmStore";

/**
 * Cross-platform confirm. Returns a Promise<boolean>: `true` when the user
 * picked the confirm button, `false` when they cancelled.
 *
 * - Native: the system alert (`Alert.alert`).
 * - Web with a mounted `ConfirmDialogHost` (Workshop): the in-app dialog —
 *   focus-trapped, Escape cancels, Enter confirms, destructive styling.
 * - Web without a host (HighScore): `window.confirm`. React Native Web's
 *   `Alert.alert` with custom buttons silently no-ops, so never use it there.
 */
export function confirm({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === "web") {
    if (confirmStore.hasHost()) {
      return confirmStore.request({ title, message, confirmLabel, cancelLabel, destructive });
    }
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      // SSR / older runtimes — no confirm available, treat as confirmed so
      // we don't strand the user with an inert button.
      return Promise.resolve(true);
    }
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(window.confirm(text));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? "destructive" : "default",
        onPress: () => resolve(true),
      },
    ]);
  });
}
