// Pure list-detail logic (UX pass phase 2): the optimistic cache edits behind
// complete / delete / move, the drag-drop resolver both platforms share, the
// keyboard "Move up / Move down" neighbours, filtering and the per-kind copy.
// No React, no network, so it is unit-tested directly (listOps.test.ts).

import type { Item, ItemKind, ListItemsResponse, MoveSection } from "@workshop/shared";
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

// --- Optimistic cache edits ------------------------------------------------

export type SectionName = "ordered" | "unordered" | "completed";

function withoutItem(data: ListItemsResponse, itemId: string): ListItemsResponse {
  return {
    ...data,
    ordered: data.ordered.filter((i) => i.id !== itemId),
    unordered: data.unordered.filter((i) => i.id !== itemId),
    completed: data.completed.filter((i) => i.id !== itemId),
  };
}

export function findItem(
  data: ListItemsResponse,
  itemId: string,
): { item: Item; section: SectionName; index: number } | null {
  for (const section of ["ordered", "unordered", "completed"] as const) {
    const index = data[section].findIndex((i) => i.id === itemId);
    const item = data[section][index];
    if (index >= 0 && item) return { item, section, index };
  }
  return null;
}

/** Done: leaves its open section and lands on top of Done. */
export function applyComplete(
  data: ListItemsResponse,
  itemId: string,
  userId: string | null,
  now: Date = new Date(),
): ListItemsResponse {
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
 * Reopened: a ranked row goes back to its rank (by `position`); anything else
 * goes back into the open block where its age puts it. The server's
 * hand-placed order wins on the refetch; for a list nobody has reordered this
 * is already exact.
 */
export function applyUncomplete(
  data: ListItemsResponse,
  itemId: string,
  rankingOn: boolean,
): ListItemsResponse {
  const found = findItem(data, itemId);
  if (found?.section !== "completed") return data;
  const rest = withoutItem(data, itemId);
  const open: Item = { ...found.item, completed: false, completedAt: null, completedBy: null };
  if (rankingOn && typeof open.position === "number") {
    const pos = open.position;
    const at = rest.ordered.findIndex((i) => (i.position ?? 0) > pos);
    const ordered = rest.ordered.slice();
    ordered.splice(at < 0 ? ordered.length : at, 0, open);
    return { ...rest, ordered };
  }
  const created = Date.parse(open.createdAt);
  const at = rest.unordered.findIndex((i) => Date.parse(i.createdAt) < created);
  const unordered = rest.unordered.slice();
  unordered.splice(at < 0 ? unordered.length : at, 0, open);
  return { ...rest, unordered };
}

/** Deleted: gone at once. */
export function applyRemove(data: ListItemsResponse, itemId: string): ListItemsResponse {
  return withoutItem(data, itemId);
}

/** Undo of a delete: back where it was, if that section still exists. */
export function applyRestore(
  data: ListItemsResponse,
  placement: { item: Item; section: SectionName; index: number },
): ListItemsResponse {
  if (findItem(data, placement.item.id)) return data;
  const list = data[placement.section].slice();
  list.splice(Math.min(placement.index, list.length), 0, placement.item);
  return { ...data, [placement.section]: list };
}

export interface MoveIntent {
  section: MoveSection;
  beforeItemId: string | null;
  afterItemId: string | null;
}

/**
 * Mirror of `POST /v1/items/:id/move` with a `section`: the row lands right
 * below `before`, else right above `after`, else at the end of Ranked / the
 * top of the open block. Neighbours that aren't in the target section are
 * ignored, the same way the server only reads their keys.
 */
export function applyMove(
  data: ListItemsResponse,
  itemId: string,
  intent: MoveIntent,
): ListItemsResponse {
  const found = findItem(data, itemId);
  if (!found || found.section === "completed") return data;
  const rest = withoutItem(data, itemId);
  const ranked = intent.section === "ranked";
  const target = (ranked ? rest.ordered : rest.unordered).slice();
  const moved: Item = {
    ...found.item,
    position: ranked ? (found.item.position ?? 0) : null,
  };
  const beforeIdx = intent.beforeItemId
    ? target.findIndex((i) => i.id === intent.beforeItemId)
    : -1;
  const afterIdx = intent.afterItemId ? target.findIndex((i) => i.id === intent.afterItemId) : -1;
  let at: number;
  if (beforeIdx >= 0) at = beforeIdx + 1;
  else if (afterIdx >= 0) at = afterIdx;
  else at = ranked ? target.length : 0;
  target.splice(at, 0, moved);
  return ranked ? { ...rest, ordered: target } : { ...rest, unordered: target };
}

// --- Drag and drop ---------------------------------------------------------

/**
 * One entry of the combined draggable list both platforms render. Rows carry
 * the section they started in; markers are layout landmarks that never move
 * by themselves:
 *
 * - `divider`: the Ranked / open boundary (web renders it as the open
 *   section's header). Above it is Ranked.
 * - `slot`: the empty Ranked section (native renders a quiet "Ranked" drop
 *   cell when there is no ranked row to drop beside). It and the row
 *   directly beneath it are Ranked.
 *
 * With no marker, the boundary is implicit: a row lands Ranked when it is at
 * the very top of a non-empty Ranked block or directly beneath a ranked row.
 */
export type DragEntry =
  | { kind: "row"; id: string; section: "ordered" | "unordered" }
  | { kind: "divider"; id: string }
  | { kind: "slot"; id: string };

export interface DropResult extends MoveIntent {
  itemId: string;
}

/**
 * Turn a library `{from, to}` (arrayMove convention, shared by dnd-kit and
 * react-native-reorderable-list) into the move to send, or null when nothing
 * changes. Neighbours are the nearest *rows* of the landing section, so a
 * drop under a filter places the row between the two rows the user saw.
 * `openReorderable: false` (album shelf: the detected block is
 * recency-sorted) drops open-to-open moves.
 */
export function resolveDrop(
  entries: readonly DragEntry[],
  from: number,
  to: number,
  options: { openReorderable?: boolean } = {},
): DropResult | null {
  const openReorderable = options.openReorderable ?? true;
  if (from === to) return null;
  if (from < 0 || from >= entries.length || to < 0 || to >= entries.length) return null;
  const moved = entries[from];
  if (moved?.kind !== "row") return null;

  const post = entries.slice();
  post.splice(from, 1);
  post.splice(to, 0, moved);

  const rankedHere = (index: number): boolean => {
    const divider = post.findIndex((e) => e.kind === "divider");
    if (divider >= 0) return index < divider;
    const slot = post.findIndex((e) => e.kind === "slot");
    if (slot >= 0) return index <= slot + 1;
    const above = post[index - 1];
    const rankedOthers = entries.some(
      (e) => e.kind === "row" && e.section === "ordered" && e.id !== moved.id,
    );
    if (index === 0) return rankedOthers;
    return !!above && above.kind === "row" && above.section === "ordered" && above.id !== moved.id;
  };

  const landsRanked = rankedHere(to);
  // Only the dragged row changes section; every other row keeps its own.
  const sectionOf = (e: DragEntry): "ordered" | "unordered" | null => {
    if (e.kind !== "row") return null;
    if (e.id === moved.id) return landsRanked ? "ordered" : "unordered";
    return e.section;
  };
  const landing = landsRanked ? "ordered" : "unordered";

  const neighbour = (step: -1 | 1): string | null => {
    for (let i = to + step; i >= 0 && i < post.length; i += step) {
      const e = post[i];
      if (e?.kind !== "row") continue;
      return sectionOf(e) === landing ? e.id : null;
    }
    return null;
  };
  const beforeItemId = neighbour(-1);
  const afterItemId = neighbour(1);

  if (moved.section === landing) {
    if (landing === "unordered" && !openReorderable) return null;
    // Same section, same neighbours: a no-op.
    const pre = entries;
    const preNeighbour = (step: -1 | 1): string | null => {
      for (let i = from + step; i >= 0 && i < pre.length; i += step) {
        const e = pre[i];
        if (e?.kind !== "row") continue;
        return e.section === landing ? e.id : null;
      }
      return null;
    };
    if (preNeighbour(-1) === beforeItemId && preNeighbour(1) === afterItemId) return null;
  }

  return {
    itemId: moved.id,
    section: landsRanked ? "ranked" : "unranked",
    beforeItemId,
    afterItemId,
  };
}

/**
 * Neighbours for the row menu's "Move up" / "Move down" (the keyboard and
 * screen-reader path for reorder), within the rows the user can see. Null
 * when the row is already at that end of its section.
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
