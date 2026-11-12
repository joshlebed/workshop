// Activity copy (UX pass 3.1 + 3.6): one verb table for the activity feed and
// the home row's second line, written in the glossary's words (docs/ux-pass-plan.md
// §6): items and lists are "deleted", a change of place is "moved", completion
// uses the list's own word, features and sources are named plainly. Pure, so it is
// unit-tested directly (activityCopy.test.ts).

import type { ActivityEvent, ItemKind } from "@workshop/shared";
import { listKind } from "@workshop/shared/listKinds";

/** Plain names for list features (the `modules` column), as list settings shows them. */
export const FEATURE_LABELS: Record<string, string> = {
  todo: "to-do",
  // Retired (one order per list); old events still name it.
  ranking: "numbering",
  sources: "syncing",
  letterboxd: "Letterboxd match",
  leaderboard: "scores",
};

const SOURCE_LABELS: Record<string, string> = {
  spotify_playlist: "a Spotify playlist",
  letterboxd_list: "a Letterboxd list",
  letterboxd_match: "Letterboxd watchlists",
};

/** Completion verbs in the list's own word: "watched", "read", "tried", "done". */
function completionWords(kind: ItemKind | null | undefined): {
  past: string;
  verb: string;
  done: boolean;
} {
  const profile = listKind(kind);
  return {
    past: profile.done.toLowerCase(),
    verb: profile.completedVerb,
    done: profile.done === "Done",
  };
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export interface DescribeOptions {
  /** The list's item kind, for the completion word. */
  kind?: ItemKind | null;
  /** Wrap item titles in quotes (the feed does; the home line does not). */
  quote?: boolean;
  /** Shorten long titles to this many characters (the home line keeps its age visible). */
  maxTitle?: number;
}

/**
 * What the actor did, without the actor: `added “Past Lives”`, `watched
 * “Past Lives”`, `deleted the list`. Every event type has a sentence; an
 * unknown type from a newer server reads "made a change".
 */
export function describeActivity(event: ActivityEvent, options: DescribeOptions = {}): string {
  const p = event.payload ?? {};
  const fullTitle = str(p, "title");
  const max = options.maxTitle;
  const rawTitle =
    fullTitle && max && fullTitle.length > max
      ? `${fullTitle.slice(0, max - 1).trimEnd()}…`
      : fullTitle;
  const title = rawTitle ? (options.quote ? `“${rawTitle}”` : rawTitle) : null;
  const t = (fallback: string) => title ?? fallback;
  const completion = completionWords(options.kind);
  switch (event.type) {
    case "list_created":
      return "created the list";
    case "list_archived":
      return "deleted the list";
    case "list_duplicated":
      return "duplicated the list";
    case "member_joined":
      return "joined";
    case "member_left":
      return "left";
    case "member_removed":
      return "removed a member";
    case "owner_transferred":
      return "handed over the list";
    case "item_added":
      return `added ${t("an item")}`;
    case "item_updated":
      return `edited ${t("an item")}`;
    case "item_archived":
      return `deleted ${t("an item")}`;
    case "item_restored":
      return `restored ${t("an item")}`;
    case "item_tagged": {
      const tags = Array.isArray(p.tags)
        ? p.tags.filter((x): x is string => typeof x === "string")
        : [];
      if (tags.length === 0) return `cleared the tags on ${t("an item")}`;
      return `tagged ${t("an item")} ${tags.map((x) => `#${x}`).join(" ")}`;
    }
    case "item_completed":
      return completion.done ? `marked ${t("an item")} done` : `${completion.verb} ${t("an item")}`;
    case "item_uncompleted":
      return `marked ${t("an item")} not ${completion.past}`;
    // One verb for every change of place. `item_promoted` is a row placed in
    // the list from a sync inbox; older events of both types were the retired
    // Ranked section's promote / demote.
    case "item_promoted":
    case "item_demoted":
      return `moved ${t("an item")}`;
    case "item_suggested":
      return `suggested ${t("a film")}`;
    case "suggestion_accepted":
      return `kept the suggestion ${t("")}`.trimEnd();
    case "invite_created":
      return "shared the link";
    case "invite_revoked":
      return "reset the share link";
    case "module_enabled":
    case "module_disabled": {
      const mod = str(p, "module");
      const label = (mod && FEATURE_LABELS[mod]) ?? "a feature";
      return `turned ${event.type === "module_enabled" ? "on" : "off"} ${label}`;
    }
    case "source_added": {
      const kind = str(p, "kind");
      return `started syncing from ${(kind && SOURCE_LABELS[kind]) ?? "another app"}`;
    }
    case "source_removed": {
      const kind = str(p, "kind");
      return `stopped syncing from ${(kind && SOURCE_LABELS[kind]) ?? "another app"}`;
    }
    case "source_updated":
      return "changed what the list syncs from";
    case "source_synced": {
      const added = typeof p.addedCount === "number" ? p.addedCount : 0;
      if (added === 0) return "synced, nothing new";
      return `synced ${added} new ${added === 1 ? "item" : "items"}`;
    }
    default:
      return "made a change";
  }
}

/** First name for compact lines ("Renata Hoh" → "Renata"); "Someone" when unknown. */
export function firstName(displayName: string | null | undefined): string {
  const trimmed = displayName?.trim();
  if (!trimmed) return "Someone";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export type ActivityMark =
  | "plus"
  | "minus"
  | "check"
  | "undo"
  | "move"
  | "in"
  | "out"
  | "sync"
  | "edit";

/** Which glyph the feed row leads with, by event family. */
export function activityMark(type: ActivityEvent["type"]): ActivityMark {
  switch (type) {
    case "item_added":
    case "item_restored":
    case "list_created":
    case "list_duplicated":
    case "invite_created":
    case "source_added":
    case "module_enabled":
    case "item_suggested":
    case "suggestion_accepted":
      return "plus";
    case "item_archived":
    case "list_archived":
    case "invite_revoked":
    case "member_removed":
    case "source_removed":
    case "module_disabled":
      return "minus";
    case "item_completed":
      return "check";
    case "item_uncompleted":
      return "undo";
    case "item_promoted":
    case "item_demoted":
      return "move";
    case "member_joined":
    case "owner_transferred":
      return "in";
    case "member_left":
      return "out";
    case "source_synced":
      return "sync";
    default:
      return "edit";
  }
}

/** Compact age for rows: "now", "8m", "2h", "3d", "2w", "4mo". */
export function shortAge(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const m = Math.floor((now - then) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(d / 365)}y`;
}

/**
 * The "New" split for the activity feed (3.6). The server keeps one read
 * marker per (viewer, list) and reports `unreadCount` = events by other people
 * after it. Events come newest first, so a list's unread events are exactly
 * its first `unreadCount` events by someone else. Given the counts as they
 * were when the screen opened, returns the ids of those events.
 */
export function newEventIds(
  events: readonly ActivityEvent[],
  unreadByList: ReadonlyMap<string, number>,
  selfId: string | null,
): Set<string> {
  const remaining = new Map(unreadByList);
  const ids = new Set<string>();
  for (const e of events) {
    if (e.actorId === selfId) continue;
    const left = remaining.get(e.listId) ?? 0;
    if (left <= 0) continue;
    ids.add(e.id);
    remaining.set(e.listId, left - 1);
  }
  return ids;
}

/**
 * Splits the feed at the read marker: new events first (newest first), then
 * everything else. When the new events are already the top of the feed (the
 * usual case) this is the feed as it was, with the divider after them.
 */
export function splitAtReadMarker<T extends { id: string }>(
  events: readonly T[],
  newIds: ReadonlySet<string>,
): { fresh: T[]; earlier: T[] } {
  const fresh: T[] = [];
  const earlier: T[] = [];
  for (const e of events) (newIds.has(e.id) ? fresh : earlier).push(e);
  return { fresh, earlier };
}
