// List template catalog. Templates are pure client-side bundles of defaults
// — the server only stores the materialized `modules` + `itemKind` + sources
// and never learns which template seeded a list. Adding a new template is
// one entry here; no schema migration.
//
// Imported at runtime by the create-list flow. Pure constants only (no zod,
// no helpers that pull in the type barrel) so Metro can resolve the subpath
// without dragging the broader `@workshop/shared` graph through.

import type { ItemKind } from "./itemKinds.js";
import type { ModuleName } from "./modules.js";
import type { SourceKind } from "./sourceKinds.js";

export type ListColor = "sunset" | "ocean" | "forest" | "grape" | "rose" | "sand" | "slate";

export interface ListTemplate {
  id: string;
  displayName: string;
  description: string;
  defaults: {
    itemKind: ItemKind | null;
    modules: ModuleName[];
    emoji: string;
    color: ListColor;
  };
  requiresSource?: {
    kind: SourceKind;
    promptCopy: string;
  };
  /**
   * A source attached automatically at create time with a fixed config —
   * no user prompt. Used by templates whose source derives everything from
   * the list itself (e.g. `letterboxd_match` reads members' watchlists).
   */
  autoSource?: {
    kind: SourceKind;
    config: Record<string, never>;
  };
}

export const LIST_TEMPLATES: readonly ListTemplate[] = [
  {
    id: "movie_watchlist",
    displayName: "Movie Watchlist",
    description: "Films to catch. Check them off, drag to rank.",
    defaults: {
      itemKind: "movie",
      modules: ["todo", "ranking"],
      emoji: "🎬",
      color: "sunset",
    },
  },
  {
    id: "tv_watchlist",
    displayName: "TV Watchlist",
    description: "Shows to start, in your order.",
    defaults: {
      itemKind: "tv",
      modules: ["todo", "ranking"],
      emoji: "📺",
      color: "ocean",
    },
  },
  {
    id: "reading_list",
    displayName: "Reading List",
    description: "Books to read, by hand-rank or whim.",
    defaults: {
      itemKind: "book",
      modules: ["todo", "ranking"],
      emoji: "📚",
      color: "forest",
    },
  },
  {
    id: "date_ideas",
    displayName: "Date Ideas",
    description: "Places, links, shared favorites.",
    defaults: {
      itemKind: "link",
      modules: ["todo", "ranking"],
      emoji: "💜",
      color: "rose",
    },
  },
  {
    id: "trip_plan",
    displayName: "Trip Plan",
    description: "Stops on an upcoming trip.",
    defaults: {
      itemKind: "link",
      modules: ["todo", "ranking"],
      emoji: "✈️",
      color: "sand",
    },
  },
  {
    id: "album_shelf",
    displayName: "Album Shelf",
    description: "Mirrors a public Spotify playlist into a rankable shelf.",
    defaults: {
      itemKind: "spotify_album",
      modules: ["ranking", "sources"],
      emoji: "💿",
      color: "grape",
    },
    requiresSource: {
      kind: "spotify_playlist",
      promptCopy: "Paste a public Spotify playlist URL. Workshop mirrors it as a shelf.",
    },
  },
  {
    id: "letterboxd_watchlist",
    displayName: "Letterboxd Watchlist",
    description: "Mirrors a public Letterboxd list. Films arrive with details from TMDB.",
    defaults: {
      itemKind: "movie",
      modules: ["todo", "ranking", "sources"],
      emoji: "🎞️",
      color: "ocean",
    },
    requiresSource: {
      kind: "letterboxd_list",
      promptCopy: "Paste a public Letterboxd list URL. Workshop mirrors it as a watchlist.",
    },
  },
  {
    id: "letterboxd_match",
    displayName: "Letterboxd Match",
    description:
      "Finds films you and your friends all want to watch, straight from your Letterboxd watchlists.",
    defaults: {
      itemKind: "movie",
      modules: ["ranking", "sources", "letterboxd"],
      emoji: "🍿",
      color: "grape",
    },
    autoSource: {
      kind: "letterboxd_match",
      config: {},
    },
  },
  {
    id: "shared_todo",
    displayName: "Shared To-Do List",
    description: "A simple checklist you can share.",
    defaults: {
      itemKind: "plain",
      modules: ["todo", "ranking"],
      emoji: "✅",
      color: "forest",
    },
  },
  {
    id: "blank_list",
    displayName: "Blank List",
    description: "Start from nothing. Add what you like.",
    defaults: {
      itemKind: null,
      modules: ["ranking"],
      emoji: "📝",
      color: "slate",
    },
  },
];

export function getTemplate(id: string): ListTemplate | null {
  return LIST_TEMPLATES.find((t) => t.id === id) ?? null;
}
