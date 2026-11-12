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

import type { ActivityEvent, ItemKind, ListSummary } from "@workshop/shared";
import { describeActivity, firstName, shortAge } from "../../lib/activityCopy";
import { completionCopy } from "../listDetail/listOps";

const NOUNS: Partial<Record<ItemKind, [string, string]>> = {
  movie: ["film", "films"],
  tv: ["show", "shows"],
  book: ["book", "books"],
  link: ["link", "links"],
  spotify_album: ["album", "albums"],
};

type CountableList = Pick<ListSummary, "itemKind" | "modules" | "itemCount" | "openItemCount">;

export function homeRowCount(list: CountableList): string {
  if (list.itemCount === 0) return "Empty";
  if (list.modules.includes("todo")) {
    const open = list.openItemCount ?? list.itemCount;
    const copy = completionCopy(list.itemKind);
    return open > 0 ? copy.openCount(open) : `All ${copy.done.toLowerCase()}`;
  }
  const [one, many] = (list.itemKind && NOUNS[list.itemKind]) ?? ["item", "items"];
  return `${list.itemCount} ${list.itemCount === 1 ? one : many}`;
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

/** Home search appears past this many lists. */
export const HOME_SEARCH_THRESHOLD = 8;
