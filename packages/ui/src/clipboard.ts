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

/**
 * Best-effort clipboard read. `null` when the clipboard is empty, holds no
 * text, or the platform refused (web needs a user gesture + permission).
 * Native reads go through `expo-clipboard`, which has shipped in every
 * HighScore binary (this module backs `Toast`'s copy affordance).
 */
export async function readClipboard(): Promise<string | null> {
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    const clip = navigator.clipboard;
    if (clip && typeof clip.readText === "function") {
      try {
        const text = await clip.readText();
        return text.length > 0 ? text : null;
      } catch {
        return null;
      }
    }
    return null;
  }
  try {
    const text = await Clipboard.getStringAsync();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
