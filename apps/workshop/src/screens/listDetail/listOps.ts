// Pure list-detail logic: the optimistic cache edits behind complete / delete
// / move, the drag-drop resolver both platforms share, the keyboard "Move up /
// Move down" neighbours, filtering and the per-kind copy.
// No React, no network, so it is unit-tested directly (listOps.test.ts).

import type { Item, ItemKind, ListRowsResponse, MoveItemRequest } from "@workshop/shared";
import { listKind } from "@workshop/shared/listKinds";

// --- Copy ------------------------------------------------------------------

export interface CompletionCopy {
  /** Section header and past participle: "Watched", "Read", "Tried", "Done". */
  done: string;
  /** Row menu / item detail primary action: "Mark watched". */
  mark: string;
  /** Inverse action: "Mark not watched". */
  unmark: string;
  /** Toast after completing: "Marked watched". */
  marked: string;
  /** Toast after reopening: "Marked not watched". */
  unmarked: string;
  /** Header count of open items: "12 to watch". */
  openCount: (n: number) => string;
}

function copyFor(word: string, verb: string): CompletionCopy {
  const lower = word.toLowerCase();
  return {
    done: word,
    mark: `Mark ${lower}`,
    unmark: `Mark not ${lower}`,
    marked: `Marked ${lower}`,
    unmarked: `Marked not ${lower}`,
    openCount: (n) => `${n} to ${verb}`,
  };
}

/**
 * The list's own completion word (glossary §6), shared by the row checkbox,
 * the row menu, the Done section header, item detail and the toasts so a
 * movie list never says "Mark complete" in one place and "Watched" in another.
 * The words live in the list-kind registry (`@workshop/shared/listKinds`).
 */
export function completionCopy(kind: ItemKind | null): CompletionCopy {
  const profile = listKind(kind);
  return copyFor(profile.done, profile.verb);
}

/** "12 films" / "1 item" for lists without completion, in the list's own noun. */
export function itemCountLabel(n: number, kind: ItemKind | null = null): string {
  const { one, many } = listKind(kind).noun;
  return `${n} ${n === 1 ? one : many}`;
}

/** "an album", "a film": a noun with its indefinite article. */
export function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}

// --- Optimistic cache edits ------------------------------------------------
//
// One order per list (docs/list-types.md → "Order"): `open` is the list, top
// first; `inbox` holds rows a sync brought in that nobody has placed yet
// (lists with a source only); `completed` is Done.

export type SectionName = "open" | "inbox" | "completed";

const SECTIONS = ["open", "inbox", "completed"] as const;

function withoutItem(data: ListRowsResponse, itemId: string): ListRowsResponse {
  return {
    ...data,
    open: data.open.filter((i) => i.id !== itemId),
    inbox: data.inbox.filter((i) => i.id !== itemId),
    completed: data.completed.filter((i) => i.id !== itemId),
  };
}

export function findItem(
  data: ListRowsResponse,
  itemId: string,
): { item: Item; section: SectionName; index: number } | null {
  for (const section of SECTIONS) {
    const index = data[section].findIndex((i) => i.id === itemId);
    const item = data[section][index];
    if (index >= 0 && item) return { item, section, index };
  }
  return null;
}

/** Done: leaves the list (or the inbox) and lands on top of Done. */
export function applyComplete(
  data: ListRowsResponse,
  itemId: string,
  userId: string | null,
  now: Date = new Date(),
): ListRowsResponse {
  const found = findItem(data, itemId);
  if (!found || found.section === "completed") return data;
  const rest = withoutItem(data, itemId);
  const done: Item = {
    ...found.item,
    completed: true,
    completedAt: now.toISOString(),
    completedBy: userId,
  };
  return { ...rest, completed: [done, ...rest.completed] };
}

/**
 * Reopened: back to its place in the list (rows keep their `position` while
 * done). A row that was never placed goes back to the inbox on a list with a
 * source, else to the top of the list, which is where the server reads it.
 */
export function applyUncomplete(
  data: ListRowsResponse,
  itemId: string,
  hasSource: boolean,
): ListRowsResponse {
  const found = findItem(data, itemId);
  if (found?.section !== "completed") return data;
  const rest = withoutItem(data, itemId);
  const open: Item = { ...found.item, completed: false, completedAt: null, completedBy: null };
  if (typeof open.position !== "number") {
    return hasSource
      ? { ...rest, inbox: [open, ...rest.inbox] }
      : { ...rest, open: [open, ...rest.open] };
  }
  const pos = open.position;
  const at = rest.open.findIndex((i) => typeof i.position === "number" && i.position > pos);
  const list = rest.open.slice();
  list.splice(at < 0 ? list.length : at, 0, open);
  return { ...rest, open: list };
}

/** Deleted: gone at once. */
export function applyRemove(data: ListRowsResponse, itemId: string): ListRowsResponse {
  return withoutItem(data, itemId);
}

/** Undo of a delete: back where it was, if that section still exists. */
export function applyRestore(
  data: ListRowsResponse,
  placement: { item: Item; section: SectionName; index: number },
): ListRowsResponse {
  if (findItem(data, placement.item.id)) return data;
  const list = data[placement.section].slice();
  list.splice(Math.min(placement.index, list.length), 0, placement.item);
  return { ...data, [placement.section]: list };
}

/**
 * Where a move puts a row: just below `beforeItemId` (the row displayed
 * above), else just above `afterItemId`, else at the top of the list.
 * `toInbox` is only the Undo of "Add to list".
 */
export interface MoveIntent {
  beforeItemId: string | null;
  afterItemId: string | null;
  toInbox?: boolean;
}

/** The request for a move (`POST /v1/items/:id/move`). */
export function moveRequest(intent: MoveIntent): MoveItemRequest {
  if (intent.toInbox) return { section: "inbox" };
  return {
    section: "list",
    beforeItemId: intent.beforeItemId,
    afterItemId: intent.afterItemId,
  };
}

/** Mirror of the server's move, on the cached rows. */
export function applyMove(
  data: ListRowsResponse,
  itemId: string,
  intent: MoveIntent,
): ListRowsResponse {
  const found = findItem(data, itemId);
  if (!found || found.section === "completed") return data;
  const rest = withoutItem(data, itemId);
  if (intent.toInbox) {
    return { ...rest, inbox: [{ ...found.item, position: null }, ...rest.inbox] };
  }
  const list = rest.open.slice();
  const beforeIdx = intent.beforeItemId ? list.findIndex((i) => i.id === intent.beforeItemId) : -1;
  const afterIdx = intent.afterItemId ? list.findIndex((i) => i.id === intent.afterItemId) : -1;
  let at: number;
  if (beforeIdx >= 0) at = beforeIdx + 1;
  else if (afterIdx >= 0) at = afterIdx;
  else at = 0;
  list.splice(at, 0, found.item);
  return { ...rest, open: list };
}

// --- Drag and drop ---------------------------------------------------------

/**
 * One entry of the draggable list both platforms render: the list's rows,
 * then (on a list with a source) the inbox's. Markers never move by
 * themselves:
 *
 * - `divider`: the inbox's heading (web). Above it is the list.
 * - `slot`: native's drop cell for an empty list over a non-empty inbox. It
 *   and the row directly beneath it are the list.
 *
 * With no marker the boundary is implicit: a row lands in the list at the
 * very top or directly beneath a list row.
 */
export type DragEntry =
  | { kind: "row"; id: string; section: "open" | "inbox" }
  | { kind: "divider"; id: string }
  | { kind: "slot"; id: string };

export interface DropResult extends MoveIntent {
  itemId: string;
}

/**
 * Turn a library `{from, to}` (arrayMove convention, shared by dnd-kit and
 * react-native-reorderable-list) into the move to send, or null when nothing
 * changes. Neighbours are the nearest list rows the person saw, so a drop
 * under a filter lands between the two visible rows. The inbox keeps its own
 * newest-first order: an inbox row dropped inside it stays put, and a list
 * row dropped into it lands at the bottom of the list.
 */
export function resolveDrop(
  entries: readonly DragEntry[],
  from: number,
  to: number,
): DropResult | null {
  if (from === to) return null;
  if (from < 0 || from >= entries.length || to < 0 || to >= entries.length) return null;
  const moved = entries[from];
  if (moved?.kind !== "row") return null;

  const post = entries.slice();
  post.splice(from, 1);
  post.splice(to, 0, moved);

  const divider = post.findIndex((e) => e.kind === "divider");
  const slot = post.findIndex((e) => e.kind === "slot");
  let landsInList: boolean;
  if (divider >= 0) landsInList = to < divider;
  else if (slot >= 0) landsInList = to <= slot + 1;
  else {
    const above = post[to - 1];
    landsInList = to === 0 || (above?.kind === "row" && above.section === "open");
  }

  const listIds = (arr: readonly DragEntry[]) =>
    arr.flatMap((e) =>
      e.kind === "row" && e.section === "open" && e.id !== moved.id ? [e.id] : [],
    );

  if (!landsInList) {
    if (moved.section === "inbox") return null;
    // A list row dropped into the inbox: the bottom of the list.
    const others = listIds(entries);
    const last = others.at(-1) ?? null;
    const preAfter = (() => {
      for (let i = from + 1; i < entries.length; i += 1) {
        const e = entries[i];
        if (e?.kind === "row") return e.section === "open" ? e.id : null;
      }
      return null;
    })();
    if (preAfter === null) return null; // already the last row of the list
    return { itemId: moved.id, beforeItemId: last, afterItemId: null };
  }

  const neighbour = (arr: readonly DragEntry[], index: number, step: -1 | 1): string | null => {
    for (let i = index + step; i >= 0 && i < arr.length; i += step) {
      const e = arr[i];
      if (e?.kind !== "row") {
        if (step === 1 && e?.kind === "divider") return null;
        continue;
      }
      if (e.id === moved.id) continue;
      return e.section === "open" ? e.id : null;
    }
    return null;
  };
  const beforeItemId = neighbour(post, to, -1);
  const afterItemId = neighbour(post, to, 1);

  if (moved.section === "open") {
    // Same neighbours as before the drag: a no-op.
    if (
      neighbour(entries, from, -1) === beforeItemId &&
      neighbour(entries, from, 1) === afterItemId
    ) {
      return null;
    }
  }
  return { itemId: moved.id, beforeItemId, afterItemId };
}

/**
 * Neighbours for the row menu's "Move up" / "Move down" (the keyboard and
 * screen-reader path for reorder), within the rows the user can see. Null
 * when the row is already at that end of the list.
 */
export function stepNeighbours(
  visible: readonly { id: string }[],
  itemId: string,
  direction: "up" | "down",
): { beforeItemId: string | null; afterItemId: string | null } | null {
  const i = visible.findIndex((r) => r.id === itemId);
  if (i < 0) return null;
  if (direction === "up") {
    if (i === 0) return null;
    return { beforeItemId: visible[i - 2]?.id ?? null, afterItemId: visible[i - 1]?.id ?? null };
  }
  if (i >= visible.length - 1) return null;
  return { beforeItemId: visible[i + 1]?.id ?? null, afterItemId: visible[i + 2]?.id ?? null };
}

// --- Filtering -------------------------------------------------------------

export interface ItemFilter {
  /** Free text; matches title, note, tags, artist/site/authors. */
  text: string;
  /** Selected tag chips (AND). */
  tags: readonly string[];
}

export function filterActive(f: ItemFilter): boolean {
  return f.text.trim().length > 0 || f.tags.length > 0;
}

function matchesText(item: Item, needle: string): boolean {
  if (!needle) return true;
  const c = item.content as { artist?: string; authors?: string[]; siteName?: string };
  const haystack = [
    item.title,
    item.note ?? "",
    (item.tags ?? []).join(" "),
    c.artist ?? "",
    c.siteName ?? "",
    Array.isArray(c.authors) ? c.authors.join(" ") : "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function matchesTags(item: Item, tags: readonly string[]): boolean {
  const own = item.tags ?? [];
  return tags.every((t) => own.includes(t));
}

export function itemMatches(item: Item, f: ItemFilter): boolean {
  return matchesTags(item, f.tags) && matchesText(item, f.text.trim().toLowerCase());
}

/**
 * Chip counts for the tag bar: one chip per tag in use anywhere on the list,
 * in a stable order (most used overall, then A–Z) so tapping a chip never
 * reshuffles the bar; each count is how many rows of the *current result*
 * carry that tag.
 */
export function tagChipCounts(
  all: readonly Item[],
  result: readonly Item[],
): { tag: string; count: number }[] {
  const total = new Map<string, number>();
  for (const it of all) for (const t of it.tags ?? []) total.set(t, (total.get(t) ?? 0) + 1);
  const inResult = new Map<string, number>();
  for (const it of result) {
    for (const t of it.tags ?? []) inResult.set(t, (inResult.get(t) ?? 0) + 1);
  }
  return [...total.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => ({ tag, count: inResult.get(tag) ?? 0 }));
}
