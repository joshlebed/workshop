import * as Clipboard from "expo-clipboard";
import { Platform } from "react-native";

const PROD_WEB_BASE_URL = "https://workshop-a2v.pages.dev";

function readShareBase(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.host}`;
  }
  const fromEnv = process.env.EXPO_PUBLIC_WEB_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
  return PROD_WEB_BASE_URL;
}

/**
 * Build the URL the owner copies to share. We prefer the web origin (works in
 * any browser) over the `workshop://` deep-link because share links typically
 * land in SMS / email / chat where the iOS app may not be installed. iOS
 * universal-link routing back into the app lands with Phase 4.
 */
export function buildInviteShareUrl(token: string): string {
  return `${readShareBase()}/invite/${encodeURIComponent(token)}`;
}

/**
 * Stable per-list URL. Members open it into the list; non-members get the
 * public landing page (`ListPublicLanding`). iOS Universal Links already
 * routes `/list/:id` into the app, so this works in both iMessage previews
 * and a regular browser.
 */
export function buildListShareUrl(listId: string): string {
  return `${readShareBase()}/list/${encodeURIComponent(listId)}`;
}

/**
 * Best-effort clipboard copy. Returns whether the write actually succeeded so
 * callers can show "Copied" vs. "Copy manually".
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
