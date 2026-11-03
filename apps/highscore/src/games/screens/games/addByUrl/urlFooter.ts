// Pure helpers behind the Add-game "add by link" footer variants. Kept free of
// React so they're unit-testable (`urlFooter.test.ts`).

import { normalizeGameUrl } from "@workshop/shared/games";

/**
 * The five footer treatments under evaluation (see `AddByUrlFooter.tsx`).
 * The picker persists the choice under `URL_FOOTER_VARIANT_STORAGE_KEY`.
 */
export const URL_FOOTER_VARIANTS = [
  { id: "1", label: "1 · Paste in field" },
  { id: "2", label: "2 · Suggest" },
  { id: "3", label: "3 · Two buttons" },
  { id: "4", label: "4 · Morph" },
  { id: "5", label: "5 · Sheet" },
] as const;

export type UrlFooterVariant = (typeof URL_FOOTER_VARIANTS)[number]["id"];

export const DEFAULT_URL_FOOTER_VARIANT: UrlFooterVariant = "1";
export const URL_FOOTER_VARIANT_STORAGE_KEY = "highscore.addGame.urlFooterVariant";

export function parseUrlFooterVariant(raw: string | null | undefined): UrlFooterVariant {
  const hit = URL_FOOTER_VARIANTS.find((v) => v.id === raw);
  return hit ? hit.id : DEFAULT_URL_FOOTER_VARIANT;
}

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

/** "https://www.nytimes.com/games/wordle/index.html?x=1" → "nytimes.com". */
export function linkHostLabel(text: string): string {
  const key = normalizeGameUrl(text.trim());
  if (!key) return text.trim();
  const slash = key.indexOf("/");
  return slash === -1 ? key : key.slice(0, slash);
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
