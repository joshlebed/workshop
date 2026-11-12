/**
 * What the share extension hands Workshop, and how it travels (UX pass 4.4).
 *
 * The native share sheet can deliver a URL, text, or both (a page title plus
 * its link; a note with a link inside). `_layout.tsx` forwards both as
 * `?url=` / `?text=` to `/share`; from there the payload rides along to the
 * list picker, through "New list", and into the new list's add surface. A
 * share that arrives while signed out is stashed here and resumed after
 * sign-in instead of being dropped.
 *
 * Everything except the three storage calls is pure and unit-tested.
 */
import { getItem, removeItem, setItem } from "@workshop/api-client/storage";
import type { CreateItemRequest, ItemContent, ItemKind, LinkPreview } from "@workshop/shared";
import { linkPreviewToItemContent } from "@workshop/shared/linkContent";

export interface SharePayload {
  url: string | null;
  text: string | null;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;
const MAX_TITLE = 500;
const MAX_NOTE = 1000;
/** A stashed share older than this is not resumed: it would be a surprise. */
export const PENDING_SHARE_TTL_MS = 24 * 60 * 60 * 1000;

export const PENDING_SHARE_KEY = "workshop.pending-share";
export const LAST_SHARE_LIST_KEY = "workshop.share.last-list";

function httpUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Tidy a raw `{ url, text }`. A "url" that isn't one is treated as text; a
 * text share that is only a link becomes a URL share; text that merely repeats
 * the URL (expo-share-intent mirrors it) is dropped. Null when nothing is left.
 */
export function normalizeSharePayload(raw: {
  url?: string | null;
  text?: string | null;
}): SharePayload | null {
  let url = raw.url?.trim() || null;
  let text = raw.text?.trim() || null;
  if (url && !httpUrl(url)) {
    text = text ?? url;
    url = null;
  }
  if (!url && text) {
    const found = text.match(URL_IN_TEXT)?.[0] ?? null;
    if (found && httpUrl(found)) url = found;
  }
  if (url && text) {
    const rest = text
      .split(url)
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
    text = rest.length > 0 ? rest : null;
  }
  if (!url && !text) return null;
  return { url, text };
}

/** `?url=&text=` for the `/share` routes and `/create-list/type`. */
export function sharePayloadParams(p: SharePayload): Record<string, string> {
  return { ...(p.url ? { url: p.url } : {}), ...(p.text ? { text: p.text } : {}) };
}

/** The add surface's prefill params: the link and the words that came with it. */
export function shareAddParams(p: SharePayload): Record<string, string> {
  return {
    ...(p.url ? { prefillUrl: p.url } : {}),
    ...(p.text ? { prefillText: p.text } : {}),
    from: "share",
  };
}

/** First non-empty line: the title a shared block of text suggests. */
export function titleFromSharedText(text: string): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstLine ?? text).replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
}

/**
 * The note a shared text leaves behind once its title is taken. With a link,
 * the whole text is the note (the link's preview names the item); without
 * one, a one-line text is all title and longer text keeps itself as the note.
 */
export function noteFromSharedText(text: string, hasUrl: boolean): string {
  if (!text) return "";
  if (hasUrl) return text.slice(0, MAX_NOTE);
  const singleLine = !/[\r\n]/.test(text) && text.length <= MAX_TITLE;
  return singleLine ? "" : text.slice(0, MAX_NOTE);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Lists whose add surface takes a free line (or a link) can be saved into
 * straight from the share picker. Search-backed lists (movies, shows, books)
 * and album shelves open their add surface with the payload prefilled.
 */
export function canQuickSave(itemKind: ItemKind | null): boolean {
  return itemKind === null || itemKind === "link" || itemKind === "plain";
}

/**
 * The item a share becomes on a quick-save list. Link previews go through
 * `linkPreviewToItemContent` (oversized social titles would 400 otherwise),
 * and only a `link` item carries preview content: a plain item keeps its URL
 * with empty content.
 */
export function sharedItemRequest(
  p: SharePayload,
  listKind: ItemKind | null,
  preview: LinkPreview | null,
): CreateItemRequest {
  const kind: ItemKind = listKind ?? (p.url ? "link" : "plain");
  const textTitle = p.text ? titleFromSharedText(p.text) : "";
  const title = (
    (p.url ? preview?.title?.trim() || textTitle || hostOf(p.url) : textTitle) || "Shared item"
  ).slice(0, MAX_TITLE);
  // With a preview title, the shared words are context worth keeping.
  const note = p.text
    ? p.url
      ? preview?.title?.trim()
        ? p.text.slice(0, MAX_NOTE)
        : noteFromSharedText(p.text, false)
      : noteFromSharedText(p.text, false)
    : "";
  const content: ItemContent | undefined =
    kind === "link" && preview ? linkPreviewToItemContent(preview) : undefined;
  return {
    kind,
    title,
    ...(p.url ? { url: p.url } : {}),
    ...(note ? { note } : {}),
    ...(content ? { content } : {}),
  };
}

/** The last list a share went into floats to the top of the picker, marked. */
export function sharePickOrder<T extends { id: string }>(
  lists: readonly T[],
  lastListId: string | null,
): T[] {
  if (!lastListId) return [...lists];
  const last = lists.find((l) => l.id === lastListId);
  return last ? [last, ...lists.filter((l) => l.id !== lastListId)] : [...lists];
}

/** Parse a stashed share, honouring the TTL. Pure; `now` is injectable. */
export function parsePendingShare(raw: string | null, now = Date.now()): SharePayload | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const v = value as { url?: unknown; text?: unknown; at?: unknown };
  if (typeof v.at !== "number" || now - v.at > PENDING_SHARE_TTL_MS || v.at > now + 60_000) {
    return null;
  }
  return normalizeSharePayload({
    url: typeof v.url === "string" ? v.url : null,
    text: typeof v.text === "string" ? v.text : null,
  });
}

export async function stashPendingShare(p: SharePayload): Promise<void> {
  await setItem(PENDING_SHARE_KEY, JSON.stringify({ ...p, at: Date.now() })).catch(() => {});
}

/** Read without clearing (the sign-in screen names what is waiting). */
export async function peekPendingShare(): Promise<SharePayload | null> {
  return parsePendingShare(await getItem(PENDING_SHARE_KEY).catch(() => null));
}

/** Single-use: read and clear, whatever it held. */
export async function takePendingShare(): Promise<SharePayload | null> {
  const raw = await getItem(PENDING_SHARE_KEY).catch(() => null);
  if (raw !== null) await removeItem(PENDING_SHARE_KEY).catch(() => {});
  return parsePendingShare(raw);
}

export async function readLastShareListId(): Promise<string | null> {
  return getItem(LAST_SHARE_LIST_KEY).catch(() => null);
}

export async function rememberShareList(listId: string): Promise<void> {
  await setItem(LAST_SHARE_LIST_KEY, listId).catch(() => {});
}

/** "Saving from nytimes.com" / "Saving shared text" for the picker's caption. */
export function shareCaption(p: SharePayload): string {
  return p.url ? `Saving from ${hostOf(p.url)}` : "Saving shared text";
}
