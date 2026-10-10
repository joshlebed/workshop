// The bottom-bar PASTE button: read the clipboard when the platform lets us
// (web with permission, native via expo-clipboard would — not a dependency
// here, so native just lands on the paste screen with its own text box) and
// hand the text to `/share/pick-game`, which recognises the game and posts.
// Anything that fails degrades to the empty paste screen; never throws.

import { Platform } from "react-native";

const MAX_LEN = 2000;

export async function readClipboardForPaste(): Promise<string | null> {
  if (Platform.OS !== "web") return null;
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { readText?: () => Promise<string> } } })
      .navigator;
    const read = nav?.clipboard?.readText;
    if (!read) return null;
    const text = (await read.call(nav?.clipboard)).trim();
    return text.length > 0 && text.length <= MAX_LEN ? text : null;
  } catch {
    return null;
  }
}
