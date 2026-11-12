/**
 * Item-detail draft reconciliation (UX pass 0.2).
 *
 * The item screen autosaves on a debounce, and every save invalidates the item
 * query, so a refetch can land while the user is still typing. The old screen
 * copied the server values back into the inputs on every refetch, which ate
 * whatever was typed after the save fired (and the trailing space the server
 * trimmed away). These helpers decide, per field, whether a server value may
 * replace the draft.
 */

export type DraftField = "title" | "note" | "url";

export interface DraftValues {
  title: string;
  note: string;
  url: string;
}

/** Server shape of the editable fields (nullable note/url). */
export interface ServerItemFields {
  title: string;
  note: string | null;
  url: string | null;
}

/** The server values as draft strings. */
export function draftFromServer(item: ServerItemFields): DraftValues {
  return { title: item.title, note: item.note ?? "", url: item.url ?? "" };
}

/**
 * What a draft field will look like once saved, for comparison with the server.
 * Title and note are trimmed on save; the URL is normalized by the caller's
 * `normalizeUrl` (the server stores `https://` + the typed host).
 */
export function savedFormOf(
  field: DraftField,
  draft: string,
  normalizeUrl: (value: string) => string | null,
): string {
  if (field === "url") return normalizeUrl(draft) ?? "";
  return draft.trim();
}

/**
 * Next draft value for one field after the server snapshot moved from
 * `prevServer` to `nextServer`:
 *  - a focused field is never touched (the user is typing in it);
 *  - an unfocused field whose draft already matches the new server value in its
 *    saved form adopts the server's exact text (trims, URL normalization);
 *  - an unfocused field with no local edit (draft matches the previous server
 *    value) follows the server, so another member's edit shows up;
 *  - anything else is a local edit not saved yet, and is kept.
 */
export function reconcileDraftField(args: {
  field: DraftField;
  draft: string;
  prevServer: string;
  nextServer: string;
  focused: boolean;
  normalizeUrl: (value: string) => string | null;
}): string {
  const { field, draft, prevServer, nextServer, focused, normalizeUrl } = args;
  if (focused) return draft;
  const saved = savedFormOf(field, draft, normalizeUrl);
  if (saved === nextServer) return nextServer;
  if (saved === savedFormOf(field, prevServer, normalizeUrl)) return nextServer;
  return draft;
}

/** True when any field differs from the server once saved. */
export function isDraftDirty(
  draft: DraftValues,
  server: DraftValues,
  normalizeUrl: (value: string) => string | null,
): boolean {
  return (["title", "note", "url"] as const).some(
    (field) => savedFormOf(field, draft[field], normalizeUrl) !== server[field],
  );
}
