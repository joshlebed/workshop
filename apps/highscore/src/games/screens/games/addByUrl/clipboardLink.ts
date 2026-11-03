// Clipboard access for the add-by-link footer.
//
// `clipboardHasLink` inspects the pasteboard's *types* (`hasUrlAsync`), which
// iOS allows without the "Allow paste?" prompt — the prompt only fires on a
// content read. Variants use it to decide whether to offer a paste at all, and
// only `readClipboardLink` (always behind a user tap) reads the text.
// `expo-clipboard` has shipped in every HighScore binary (it backs
// `readClipboard` in `@workshop/ui/clipboard`), so no runtime gate is needed.

import { readClipboard } from "@workshop/ui/clipboard";
import * as Clipboard from "expo-clipboard";
import { Platform } from "react-native";
import { type ClipboardRead, classifyClipboard } from "./urlFooter";

export async function clipboardHasLink(): Promise<boolean> {
  // Browsers expose no type sniffing without a permission prompt.
  if (Platform.OS === "web") return false;
  try {
    return await Clipboard.hasUrlAsync();
  } catch {
    return false;
  }
}

export async function readClipboardLink(): Promise<ClipboardRead> {
  return classifyClipboard(await readClipboard());
}
