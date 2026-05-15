import { Alert, Platform } from "react-native";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/**
 * Cross-platform confirm dialog. React Native Web's `Alert.alert` with custom
 * buttons silently no-ops, which has bitten us on the desktop sign-out flow
 * and elsewhere — sign-out tapped nothing. Use `window.confirm` on web and
 * `Alert.alert` on native (where it renders a native modal).
 *
 * Returns a Promise<boolean>: `true` when the user picked the confirm button,
 * `false` when they cancelled.
 */
export function confirm({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === "web") {
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
