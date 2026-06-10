import * as Clipboard from "expo-clipboard";
import { Platform, Share } from "react-native";

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
 * Build the short, copyable share URL for a list. Each list has exactly one
 * slug (rotatable from settings); this is the URL we put in iMessage / Slack /
 * email and that the OG pipeline renders thumbnails for. iOS Universal Links
 * routes `/l/*` into the app for installed users; non-members hit the public
 * landing (`ListPublicLanding`).
 */
export function buildListShareUrl(shareSlug: string): string {
  return `${readShareBase()}/l/${encodeURIComponent(shareSlug)}`;
}

/**
 * The canonical-by-id URL — what the browser sits on after a member opens a
 * list from home. Stable for bookmarks. Non-members hitting this still see
 * the public landing, but the OG card is intentionally generic (no list
 * details leaked to anyone without the slug).
 */
export function buildListByIdUrl(listId: string): string {
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

/**
 * Hand a share URL to the system share sheet on native, or copy it to the
 * clipboard on web (where there's no share sheet — RNW's `Share` only works
 * behind the not-always-present Web Share API). On native a thrown error
 * (sheet unavailable) falls back to a clipboard copy; a user dismissing the
 * sheet still counts as `"shared"`. Returns what actually happened so callers
 * can pick the right toast.
 */
export async function shareOrCopyLink(url: string): Promise<"shared" | "copied" | "failed"> {
  if (Platform.OS !== "web") {
    try {
      await Share.share({ message: url });
      return "shared";
    } catch {
      // Share sheet unavailable — fall through to a clipboard copy.
    }
  }
  const copied = await copyToClipboard(url);
  return copied ? "copied" : "failed";
}
