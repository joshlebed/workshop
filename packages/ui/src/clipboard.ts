import * as Clipboard from "expo-clipboard";
import { Platform } from "react-native";

/**
 * Best-effort clipboard copy. Returns whether the write actually succeeded so
 * callers can show "Copied" vs. "Copy manually".
 *
 * Lives in the design system because `Toast` offers a copy affordance on
 * danger toasts; app-level share helpers (`shareOrCopyLink`) build on top of
 * it.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      try {
        await clip.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
