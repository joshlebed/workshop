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

/**
 * Where a template sits in the create-list picker (UX pass 4.3). The picker
 * renders one `SectionHeader` per group, in `TEMPLATE_GROUPS` order.
 */
export type TemplateGroup = "simple" | "watch_read" | "plans" | "import";

export const TEMPLATE_GROUPS: readonly { id: TemplateGroup; title: string }[] = [
  { id: "simple", title: "Start simple" },
  { id: "watch_read", title: "Watch and read" },
  { id: "plans", title: "Plans" },
  { id: "import", title: "Import" },
];

export interface ListTemplate {
  id: string;
  /** Sentence case, as it reads in the picker ("Movie watchlist"). */
  displayName: string;
  /**
   * The name a list made from this template starts with. Tapping a template
   * creates the list at once (4.3), so this is what lands on home until the
   * person renames it. Falls back to `displayName`.
   */
  defaultName?: string;
  description: string;
  group: TemplateGroup;
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

// Picker order: Blank first, then by group. `groupTemplates` keeps this
// order inside each group.
export const LIST_TEMPLATES: readonly ListTemplate[] = [
  {
    id: "blank_list",
    displayName: "Blank list",
    defaultName: "New list",
    description: "Start from nothing. Add what you like.",
    group: "simple",
    defaults: {
      itemKind: null,
      modules: ["ranking"],
      emoji: "📝",
      color: "slate",
    },
  },
  {
    id: "shared_todo",
    displayName: "To-do list",
    defaultName: "To-do",
    description: "A checklist you can share.",
    group: "simple",
    defaults: {
      itemKind: "plain",
      modules: ["todo", "ranking"],
      emoji: "✅",
      color: "forest",
    },
  },
  {
    id: "movie_watchlist",
    displayName: "Movie watchlist",
    defaultName: "Movies to watch",
    description: "Films to catch. Check them off, drag to rank.",
    group: "watch_read",
    defaults: {
      itemKind: "movie",
      modules: ["todo", "ranking"],
      emoji: "🎬",
      color: "sunset",
    },
  },
  {
    id: "tv_watchlist",
    displayName: "TV watchlist",
    defaultName: "Shows to watch",
    description: "Shows to start, in your order.",
    group: "watch_read",
    defaults: {
      itemKind: "tv",
      modules: ["todo", "ranking"],
      emoji: "📺",
      color: "ocean",
    },
  },
  {
    id: "reading_list",
    displayName: "Reading list",
    defaultName: "Books to read",
    description: "Books to read, by hand-rank or whim.",
    group: "watch_read",
    defaults: {
      itemKind: "book",
      modules: ["todo", "ranking"],
      emoji: "📚",
      color: "forest",
    },
  },
  {
    id: "date_ideas",
    displayName: "Date ideas",
    description: "Places, links, shared favorites.",
    group: "plans",
    defaults: {
      itemKind: "link",
      modules: ["todo", "ranking"],
      emoji: "💜",
      color: "rose",
    },
  },
  {
    id: "trip_plan",
    displayName: "Trip plan",
    description: "Stops on an upcoming trip.",
    group: "plans",
    defaults: {
      itemKind: "link",
      modules: ["todo", "ranking"],
      emoji: "✈️",
      color: "sand",
    },
  },
  {
    id: "album_shelf",
    displayName: "Album shelf",
    description: "Albums from a public Spotify playlist.",
    group: "import",
    defaults: {
      itemKind: "spotify_album",
      modules: ["ranking", "sources"],
      emoji: "💿",
      color: "grape",
    },
    requiresSource: {
      kind: "spotify_playlist",
      promptCopy: "Every album on the playlist becomes a row on your shelf, and new ones follow.",
    },
  },
  {
    id: "letterboxd_watchlist",
    displayName: "Letterboxd watchlist",
    description: "A public Letterboxd list, kept in step.",
    group: "import",
    defaults: {
      itemKind: "movie",
      modules: ["todo", "ranking", "sources"],
      emoji: "🎞️",
      color: "ocean",
    },
    requiresSource: {
      kind: "letterboxd_list",
      promptCopy: "Every film on the list becomes a row here, and new ones follow.",
    },
  },
  {
    id: "letterboxd_match",
    displayName: "Letterboxd match",
    defaultName: "Films we all want to see",
    description: "Films everyone on the list wants to see.",
    group: "import",
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
];

/** The templates in each picker group, groups in `TEMPLATE_GROUPS` order, empty groups dropped. */
export function groupTemplates(
  templates: readonly ListTemplate[] = LIST_TEMPLATES,
): { id: TemplateGroup; title: string; templates: ListTemplate[] }[] {
  return TEMPLATE_GROUPS.map((g) => ({
    ...g,
    templates: templates.filter((t) => t.group === g.id),
  })).filter((g) => g.templates.length > 0);
}

/** The name a list made from `template` starts with. */
export function templateListName(template: ListTemplate): string {
  return template.defaultName ?? template.displayName;
}

export function getTemplate(id: string): ListTemplate | null {
  return LIST_TEMPLATES.find((t) => t.id === id) ?? null;
}
