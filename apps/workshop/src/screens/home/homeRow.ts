// The home row's one quiet second line (UX pass 3.1). Every row follows the
// same rule:
//
//   <count in the list's own noun> · <who did what last> · <age>
//
//   "12 to watch · Renata added Past Lives · 2d"
//   "All done · You marked Milk done · 3h"
//   "4 albums · updated 2w"         (no recent event in the feed)
//   "Empty · updated 1mo"
//
// The count is open items with the list's completion word when the list has
// to-do on ("12 to watch", "3 to do", "All read" once everything is done), and
// the plain noun otherwise ("6 films", "4 albums", "9 items"). The activity
// clause is the list's latest event from the feed; without one it falls back to
// the list's `updatedAt`. The list description no longer competes for the line.

import type { ActivityEvent, ListSummary } from "@workshop/shared";
import { describeActivity, firstName, shortAge } from "../../lib/activityCopy";
import { completionCopy, itemCountLabel } from "../listDetail/listOps";

type CountableList = Pick<ListSummary, "itemKind" | "modules" | "itemCount" | "openItemCount">;

export function homeRowCount(list: CountableList): string {
  if (list.itemCount === 0) return "Empty";
  if (list.modules.includes("todo")) {
    const open = list.openItemCount ?? list.itemCount;
    const copy = completionCopy(list.itemKind);
    return open > 0 ? copy.openCount(open) : `All ${copy.done.toLowerCase()}`;
  }
  return itemCountLabel(list.itemCount, list.itemKind);
}

export function homeRowSubtitle(
  list: CountableList & Pick<ListSummary, "updatedAt">,
  latestEvent: ActivityEvent | null,
  selfId: string | null,
  now = Date.now(),
): string {
  const count = homeRowCount(list);
  if (latestEvent) {
    const who = latestEvent.actorId === selfId ? "You" : firstName(latestEvent.actorDisplayName);
    const what = describeActivity(latestEvent, { kind: list.itemKind, maxTitle: 22 });
    const age = shortAge(latestEvent.createdAt, now);
    return [count, `${who} ${what}`, age].filter(Boolean).join(" · ");
  }
  const age = shortAge(list.updatedAt, now);
  return age ? `${count} · updated ${age}` : count;
}

/** Search on home: case- and accent-insensitive match on the list name. */
export function matchesListSearch(name: string, query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = fold(query.trim());
  return q.length === 0 || fold(name).includes(q);
}

/**
 * The faces in a home row's member stack: three when that is everyone,
 * otherwise two and a "+N". Null when there is no preview to draw (a response
 * cached before `memberPreview` existed): a bare "+1" with no faces reads as
 * noise, so the row shows nothing until the next fetch brings faces.
 */
export function memberStackFaces<M>(
  others: number,
  preview: readonly M[] | undefined,
): { shown: M[]; extra: number } | null {
  if (others <= 0 || !preview || preview.length === 0) return null;
  const shown = preview.slice(0, others <= 3 ? 3 : 2);
  return { shown, extra: Math.max(0, others - shown.length) };
}

/** Home search appears past this many lists. */
export const HOME_SEARCH_THRESHOLD = 8;
