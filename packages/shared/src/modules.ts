// List module registry. A list's `modules` array declares which behaviors are
// active. Each module is a pure string identifier; the DB stores names and
// the app interprets them.

export const MODULE_NAMES = ["todo", "voting", "ranking", "leaderboard", "sources"] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export function isModuleName(value: unknown): value is ModuleName {
  return typeof value === "string" && (MODULE_NAMES as readonly string[]).includes(value);
}

export function normalizeModules(modules: readonly string[]): ModuleName[] {
  const seen = new Set<ModuleName>();
  for (const m of modules) {
    if (isModuleName(m)) seen.add(m);
  }
  return MODULE_NAMES.filter((m) => seen.has(m));
}

export function hasModule(modules: readonly string[], name: ModuleName): boolean {
  return modules.includes(name);
}

// Stable warning codes emitted by `POST /v1/lists/:id/config-preview` when a
// module is removed from a list that still has associated data. Clients echo
// the codes back in `acknowledgedWarnings` on `PATCH /v1/lists/:id`.
export const MODULE_REMOVAL_WARNINGS = {
  todo: "todo.hide_completed",
  voting: "voting.hide_upvotes",
  ranking: "ranking.hide_order",
  leaderboard: "leaderboard.hide_scores",
  sources: "sources.deactivate_sources",
} as const satisfies Record<ModuleName, string>;

export type ModuleWarningCode = (typeof MODULE_REMOVAL_WARNINGS)[ModuleName];

export interface ConfigWarning {
  code: string;
  message: string;
  affectedCount?: number;
}
