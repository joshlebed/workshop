// List kinds: the one registry of what each list type offers.
//
// A list's storage is two independent columns: `item_kind` (what a row holds:
// movie, book, link, … or NULL for a blank list that takes anything) and
// `modules` (which optional behaviours are on). Nothing used to connect them,
// so list settings offered Letterboxd matching on a to-do list and "Syncing"
// on a list of notes. This registry is the missing rule. For each kind it says
// which features are offered, what each is called in that list's own words,
// how a row is added, and what the list calls its things. Settings, the create
// flow, list detail, the add surface, home rows and the backend's validation
// all read it, so per-type behaviour lives here instead of in scattered
// `if (itemKind === …)` branches. The matrix is written out in
// docs/list-types.md.
//
// Three kinds of feature:
// - **Toggles** (`todo`, `ranking`, `letterboxd`): the owner turns them on and
//   off in list settings. `todo` and `ranking` are offered on every kind;
//   `letterboxd` only on movie lists.
// - **Derived** (`sources`): never a toggle. It is on exactly when the list has
//   at least one attached source, and the backend keeps it that way in the
//   same transaction that attaches or removes one (see `resolveListModules`).
//   Kinds with a `syncSources` entry get a "Synced from" section in settings.
// - **Legacy** (`leaderboard`): retired, never offered, left alone where it
//   still exists.
//
// Runtime-imported by the Workshop client, so this module must not
// value-import a sibling (Metro cannot resolve `./x.js`; see CLAUDE.md). The
// module order below repeats `MODULE_NAMES` and `listKinds.test.ts` pins it.

import type { ItemKind } from "./itemKinds.js";
import type { ModuleName } from "./modules.js";
import type { SourceKind } from "./sourceKinds.js";

/** A list's kind: its `item_kind`, or `blank` for a list with none. */
export type ListKindKey = ItemKind | "blank";

/** Features the owner turns on and off. `sources` is derived, `leaderboard` retired. */
export type ToggleFeature = "todo" | "ranking" | "letterboxd";

export const TOGGLE_FEATURES: readonly ToggleFeature[] = ["todo", "ranking", "letterboxd"];

/** Source kinds a person attaches by link ("Synced from"). `letterboxd_match` belongs to its feature. */
export type SyncSourceKind = Extract<SourceKind, "spotify_playlist" | "letterboxd_list">;

export const SYNC_SOURCE_KINDS: readonly SyncSourceKind[] = ["spotify_playlist", "letterboxd_list"];

/** The source the Letterboxd match toggle owns (its config is `{}`). */
export const LETTERBOXD_MATCH_SOURCE_KIND = "letterboxd_match" satisfies SourceKind;

/** How a row gets onto the list. */
export type AddMode =
  /** Type to search a catalogue (TMDB, Google Books), or add the typed title anyway. */
  | "search"
  /** One line at a time, optional link, note and tags. */
  | "quick"
  /** Rows only arrive from the attached source; there is no manual add. */
  | "sync_only";

export interface ListKindProfile {
  key: ListKindKey;
  /** The read-only kind line in list settings: "Movies", "Anything". */
  label: string;
  /** What the list calls one and many of its rows: "film" / "films". */
  noun: { one: string; many: string };
  /** The completion word (glossary §6): section header and past participle. */
  done: string;
  /** "N to <verb>" on the header and home row: "watch", "listen to". */
  verb: string;
  /** The activity verb for completing a row: "watched", "listened to". */
  completedVerb: string;
  /** Toggles offered, in display order. */
  features: readonly ToggleFeature[];
  /** Sources a person can connect ("Synced from"); empty = no such section. */
  syncSources: readonly SyncSourceKind[];
  add: {
    mode: AddMode;
    /** Whether "Paste many" is offered. */
    bulk: boolean;
    /** The add surface's title. */
    title: string;
  };
  /** The zero-rows empty state when nothing feeds the list. */
  empty: { title: string; description: string; action: string };
  /** Rows show an artwork tile. */
  cover: boolean;
  /** Placeholder glyph for a row or item with no artwork. */
  glyph: string;
}

const BASIC_FEATURES: readonly ToggleFeature[] = ["todo", "ranking"];

export const LIST_KINDS: Readonly<Record<ListKindKey, ListKindProfile>> = {
  blank: {
    key: "blank",
    label: "Anything",
    noun: { one: "item", many: "items" },
    done: "Done",
    verb: "do",
    completedVerb: "done",
    features: BASIC_FEATURES,
    syncSources: [],
    add: { mode: "quick", bulk: true, title: "Add items" },
    empty: {
      title: "Nothing here yet",
      description: "Add the first thing you want to remember.",
      action: "Add an item",
    },
    cover: false,
    glyph: "📝",
  },
  plain: {
    key: "plain",
    label: "Text items",
    noun: { one: "item", many: "items" },
    done: "Done",
    verb: "do",
    completedVerb: "done",
    features: BASIC_FEATURES,
    syncSources: [],
    add: { mode: "quick", bulk: true, title: "Add items" },
    empty: {
      title: "Nothing here yet",
      description: "Add the first thing you want to remember.",
      action: "Add an item",
    },
    cover: false,
    glyph: "📝",
  },
  link: {
    key: "link",
    label: "Links and places",
    noun: { one: "link", many: "links" },
    done: "Tried",
    verb: "try",
    completedVerb: "tried",
    features: BASIC_FEATURES,
    syncSources: [],
    add: { mode: "quick", bulk: true, title: "Add items" },
    empty: {
      title: "Nothing saved yet",
      description: "Add the first link you want to come back to.",
      action: "Add a link",
    },
    cover: true,
    glyph: "🔗",
  },
  movie: {
    key: "movie",
    label: "Movies",
    noun: { one: "film", many: "films" },
    done: "Watched",
    verb: "watch",
    completedVerb: "watched",
    features: ["todo", "ranking", "letterboxd"],
    syncSources: ["letterboxd_list"],
    add: { mode: "search", bulk: true, title: "Add movies" },
    empty: {
      title: "No movies yet",
      description: "Add the first one you want to watch.",
      action: "Add a movie",
    },
    cover: true,
    glyph: "🎬",
  },
  tv: {
    key: "tv",
    label: "TV shows",
    noun: { one: "show", many: "shows" },
    done: "Watched",
    verb: "watch",
    completedVerb: "watched",
    features: BASIC_FEATURES,
    syncSources: [],
    add: { mode: "search", bulk: true, title: "Add shows" },
    empty: {
      title: "No shows yet",
      description: "Add the first one you want to watch.",
      action: "Add a show",
    },
    cover: true,
    glyph: "📺",
  },
  book: {
    key: "book",
    label: "Books",
    noun: { one: "book", many: "books" },
    done: "Read",
    verb: "read",
    completedVerb: "read",
    features: BASIC_FEATURES,
    syncSources: [],
    add: { mode: "search", bulk: true, title: "Add books" },
    empty: {
      title: "Nothing on the shelf yet",
      description: "Add the first book you want to read.",
      action: "Add a book",
    },
    cover: true,
    glyph: "📚",
  },
  spotify_album: {
    key: "spotify_album",
    label: "Albums",
    noun: { one: "album", many: "albums" },
    done: "Listened",
    verb: "listen to",
    completedVerb: "listened to",
    features: BASIC_FEATURES,
    syncSources: ["spotify_playlist"],
    // An album row needs Spotify's ids and artwork; it only arrives by sync.
    add: { mode: "sync_only", bulk: false, title: "Add albums" },
    empty: {
      title: "No playlist connected",
      description: "This shelf fills itself from a public Spotify playlist.",
      action: "Connect a playlist",
    },
    cover: true,
    glyph: "📀",
  },
};

/** The kind key for a list's `itemKind` (unknown or NULL reads as `blank`). */
export function listKindKey(itemKind: string | null | undefined): ListKindKey {
  if (itemKind && Object.hasOwn(LIST_KINDS, itemKind)) return itemKind as ListKindKey;
  return "blank";
}

export function listKind(itemKind: string | null | undefined): ListKindProfile {
  return LIST_KINDS[listKindKey(itemKind)];
}

// --- Features ----------------------------------------------------------------

export interface FeatureCopy {
  label: string;
  description: string;
}

/** A toggle's label and description in the list's own words. */
export function featureCopy(
  itemKind: string | null | undefined,
  feature: ToggleFeature,
): FeatureCopy {
  const kind = listKind(itemKind);
  switch (feature) {
    case "todo":
      return {
        label: kind.done === "Done" ? "Check things off" : `Mark ${kind.done.toLowerCase()}`,
        description: `Ticked ${kind.noun.many} move to a ${kind.done} section.`,
      };
    case "ranking":
      return {
        label: "Ranked section",
        description: `Number your top ${kind.noun.many} above the rest. Dragging works either way.`,
      };
    case "letterboxd":
      return {
        label: "Letterboxd match",
        description: "Suggest films everyone on this list has on their Letterboxd watchlist.",
      };
  }
}

export function isFeatureOffered(itemKind: string | null | undefined, feature: string): boolean {
  return (listKind(itemKind).features as readonly string[]).includes(feature);
}

export function isSyncSourceOffered(
  itemKind: string | null | undefined,
  sourceKind: string,
): boolean {
  return (listKind(itemKind).syncSources as readonly string[]).includes(sourceKind);
}

// --- Sources -------------------------------------------------------------------

export interface SyncSourceCopy {
  /** "Spotify playlist" */
  name: string;
  /** "Connect a Spotify playlist" */
  connect: string;
  /** The config key the link goes in (`POST /v1/lists/:id/sources`). */
  configKey: "spotifyPlaylistUrl" | "letterboxdUrl";
  placeholder: string;
  /** One line under the field. */
  help: string;
}

export const SYNC_SOURCE_COPY: Readonly<Record<SyncSourceKind, SyncSourceCopy>> = {
  spotify_playlist: {
    name: "Spotify playlist",
    connect: "Connect a Spotify playlist",
    configKey: "spotifyPlaylistUrl",
    placeholder: "open.spotify.com/playlist/…",
    help: "Every album on a public playlist becomes a row here, and new ones follow.",
  },
  letterboxd_list: {
    name: "Letterboxd list",
    connect: "Connect a Letterboxd list",
    configKey: "letterboxdUrl",
    placeholder: "letterboxd.com/you/list/…",
    help: "Every film on a public list becomes a row here, and new ones follow.",
  },
};

/** Display name for any attached source kind, including the Letterboxd-match one. */
export function sourceDisplayName(kind: string): string {
  if (kind === LETTERBOXD_MATCH_SOURCE_KIND) return "Members' Letterboxd watchlists";
  return (SYNC_SOURCE_COPY as Partial<Record<string, SyncSourceCopy>>)[kind]?.name ?? "Linked list";
}

// --- Module resolution (backend) -------------------------------------------------

// Same order as `MODULE_NAMES` in ./modules.ts (pinned by listKinds.test.ts).
const MODULE_ORDER: readonly ModuleName[] = [
  "todo",
  "ranking",
  "leaderboard",
  "sources",
  "letterboxd",
];

function ordered(set: ReadonlySet<string>): ModuleName[] {
  return MODULE_ORDER.filter((m) => set.has(m));
}

export interface ResolvedModules {
  /** The modules to store. */
  modules: ModuleName[];
  /** Toggles the request turned on that this kind does not offer (400 `feature_not_offered`). */
  notOffered: ToggleFeature[];
}

/**
 * The modules a list should store, given what a client asked for.
 *
 * - `sources` in the request is ignored: it is derived. It comes out on
 *   exactly when the list will have a source: a sync source
 *   (`syncSourceCount > 0`) or the Letterboxd-match source, which the
 *   `letterboxd` toggle owns.
 * - A toggle this kind does not offer is reported in `notOffered` when the
 *   request turns it on, and kept when the list already had it (`current`), so
 *   a client resending a list's whole array never trips over a feature the
 *   data migration has not stripped yet.
 * - `leaderboard` passes through untouched; the retired-game-list rule decides
 *   about it separately.
 */
export function resolveListModules(args: {
  itemKind: string | null | undefined;
  requested: readonly string[];
  current?: readonly string[] | null;
  syncSourceCount: number;
}): ResolvedModules {
  const current = new Set(args.current ?? []);
  const next = new Set<string>();
  const notOffered: ToggleFeature[] = [];
  for (const m of args.requested) {
    if (m === "sources") continue;
    if ((TOGGLE_FEATURES as readonly string[]).includes(m)) {
      const feature = m as ToggleFeature;
      if (isFeatureOffered(args.itemKind, feature) || current.has(feature)) next.add(feature);
      else if (!notOffered.includes(feature)) notOffered.push(feature);
      continue;
    }
    if ((MODULE_ORDER as readonly string[]).includes(m)) next.add(m);
  }
  const matchSource = next.has("letterboxd") && isFeatureOffered(args.itemKind, "letterboxd");
  if (args.syncSourceCount > 0 || matchSource) next.add("sources");
  return { modules: ordered(next), notOffered };
}
