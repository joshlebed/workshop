// List module registry. A list's `modules` array declares which behaviors are
// active. Each module is a pure string identifier; the DB stores names and
// the app interprets them.

export const MODULE_NAMES = ["todo", "ranking", "leaderboard", "sources", "letterboxd"] as const;

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
  ranking: "ranking.hide_order",
  leaderboard: "leaderboard.hide_scores",
  sources: "sources.deactivate_sources",
  letterboxd: "letterboxd.hide_match",
} as const satisfies Record<ModuleName, string>;

export type ModuleWarningCode = (typeof MODULE_REMOVAL_WARNINGS)[ModuleName];

export interface ConfigWarning {
  code: string;
  message: string;
  affectedCount?: number;
}

/**
 * Per-code client-side copy for module-removal warnings. Centralizes the
 * pretty copy off the server's bare "N completed items will be hidden." so
 * the UI can ship localized strings later without coordinating with the
 * backend. Fall back to the server's `message` for codes the client doesn't
 * know (forward compatible — adding a new module warning code works on
 * stale clients via the server message).
 *
 * Returns `{ headline, detail }`:
 * - `headline` — bold, scannable lead ("Hide 3 completed items?")
 * - `detail`   — secondary explanatory line preserving the safety net
 *                ("They stay in the database — re-enable To-Do anytime to
 *                bring them back.")
 */
export interface PrettyWarningCopy {
  headline: string;
  detail: string;
}

function plural(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function formatConfigWarning(warning: ConfigWarning): PrettyWarningCopy {
  const count = warning.affectedCount ?? 0;
  switch (warning.code) {
    case MODULE_REMOVAL_WARNINGS.todo:
      return {
        headline: `Hide ${count} completed ${plural(count, "item", "items")}?`,
        detail: "They stay in the database — re-enable To-Do anytime to bring them back.",
      };
    case MODULE_REMOVAL_WARNINGS.ranking:
      return {
        headline: `Drop the manual order from ${count} ${plural(count, "item", "items")}?`,
        detail: "Positions stay on the rows; re-enable Ranking to restore the order.",
      };
    case MODULE_REMOVAL_WARNINGS.leaderboard:
      return {
        headline: `Hide ${count} ${plural(count, "score", "scores")}?`,
        detail: "Scores are preserved — re-enable Leaderboard to surface them again.",
      };
    case MODULE_REMOVAL_WARNINGS.sources:
      return {
        headline: `Stop syncing ${count} attached ${plural(count, "source", "sources")}?`,
        detail: "Items already imported stay. Re-enable Sources to resume syncing.",
      };
    case MODULE_REMOVAL_WARNINGS.letterboxd:
      return {
        headline: `Turn ${count} pending ${plural(count, "suggestion", "suggestions")} into regular items?`,
        detail:
          "Watchlist matching stops and suggestions lose their accept flow. Re-enable Letterboxd to bring it back.",
      };
    default:
      return { headline: "Heads up", detail: warning.message };
  }
}
