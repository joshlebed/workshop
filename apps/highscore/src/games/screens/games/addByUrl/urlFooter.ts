// Pure helpers behind the Add-game "add by link" footer variants. Kept free of
// React so they're unit-testable (`urlFooter.test.ts`).

import { normalizeGameUrl } from "@workshop/shared/games";

/**
 * Would the backend accept this as a game URL? Same rule as the server's
 * dedup key: an http(s) URL (scheme optional) with a dotted host, no
 * whitespace. A pasted score ("Wordle 1,234 4/6 …") or a bare word is not.
 */
export function isLikelyGameUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) return false;
  return normalizeGameUrl(trimmed) !== null;
}

/** What a clipboard read turned out to hold. */
export type ClipboardRead =
  | { kind: "link"; text: string }
  | { kind: "text"; text: string }
  | { kind: "empty" };

export function classifyClipboard(raw: string | null): ClipboardRead {
  const text = raw?.trim() ?? "";
  if (!text) return { kind: "empty" };
  return isLikelyGameUrl(text) ? { kind: "link", text } : { kind: "text", text };
}
