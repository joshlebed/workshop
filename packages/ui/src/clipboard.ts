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

const WEB_READ_TIMEOUT_MS = 800;

/**
 * Best-effort clipboard read, for a paste affordance that pre-fills a field
 * on tap. Must be called from a user gesture: on web `readText` is gated on
 * one (and Firefox denies it outright), on iOS a read outside a tap shows the
 * system paste prompt. Returns null when nothing is there or the read is
 * refused — callers fall back to an empty, focused field.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (Platform.OS === "web" && typeof navigator !== "undefined") {
      const clip = navigator.clipboard;
      if (!clip || typeof clip.readText !== "function") return null;
      // A pending permission prompt the user never answers would otherwise
      // hold the tap forever; past this the caller proceeds with nothing.
      const text = await Promise.race([
        clip.readText(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), WEB_READ_TIMEOUT_MS)),
      ]);
      return text?.trim() ? text : null;
    }
    const text = await Clipboard.getStringAsync();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}
