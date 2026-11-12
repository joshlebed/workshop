import { Platform, Share } from "react-native";
import { copyToClipboard } from "./clipboard";

export interface ShareOrCopyOptions {
  /**
   * On web, open the browser's share sheet (`navigator.share`) when it has
   * one, before falling back to a copy. Opt-in so callers that always copied
   * on web (HighScore) keep doing so.
   */
  webShare?: boolean;
  /** Title for the share sheet (web share data `title`). */
  title?: string;
}

export type ShareOrCopyResult = "shared" | "copied" | "cancelled" | "failed";

interface WebShareNavigator {
  share?: (data: { url?: string; title?: string }) => Promise<void>;
  canShare?: (data: { url?: string; title?: string }) => boolean;
}

/** Open the native share sheet, falling back to a clipboard copy. */
export async function shareOrCopyLink(
  url: string,
  options: ShareOrCopyOptions = {},
): Promise<ShareOrCopyResult> {
  if (Platform.OS !== "web") {
    try {
      await Share.share({ message: url });
      return "shared";
    } catch {
      // Share sheet unavailable — fall through to a clipboard copy.
    }
  } else if (options.webShare && typeof navigator !== "undefined") {
    const nav = navigator as unknown as WebShareNavigator;
    const data = { url, ...(options.title ? { title: options.title } : {}) };
    if (typeof nav.share === "function" && (nav.canShare?.(data) ?? true)) {
      try {
        await nav.share(data);
        return "shared";
      } catch (e) {
        // The person closed the sheet: nothing to report, nothing to copy.
        if ((e as { name?: string } | null)?.name === "AbortError") return "cancelled";
        // Not allowed here (no user activation, insecure context): copy instead.
      }
    }
  }
  return (await copyToClipboard(url)) ? "copied" : "failed";
}
