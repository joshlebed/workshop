// Module-gate helper. Module-specific endpoints (complete, score, sources,
// move) return 409 with a stable code when the gating module is off on the
// parent list (§5.1 of docs/list-data-model-redesign.md).

import { hasModule, type ModuleName } from "@workshop/shared/modules";
import type { Context } from "hono";
import { err } from "./response.js";

const MESSAGES: Record<ModuleName, string> = {
  todo: "This list doesn't have completion enabled. Turn on “To-do” in list settings to complete items.",
  ranking:
    "This list doesn't have manual ordering enabled. Turn on “Ranking” in list settings to reorder items.",
  leaderboard:
    "This list doesn't have a leaderboard. Turn on “Leaderboard” in list settings to submit scores.",
  sources:
    "This list doesn't have external sources enabled. Turn on “Sources” in list settings to attach a source.",
};

/**
 * Returns null on success or a 409 Response to bubble up if `module` is not
 * enabled on the list. Callers should `if (gate) return gate;` after.
 */
export function requireModule(
  c: Context,
  modules: readonly string[],
  module: ModuleName,
): Response | null {
  if (hasModule(modules, module)) return null;
  return err(
    c,
    "CONFLICT",
    "module_disabled",
    {
      code: `${module}.disabled`,
      module,
      message: MESSAGES[module],
    },
    409,
  );
}

/**
 * Strip module-gated fields from a serialized item so clients never see
 * preserved-but-hidden data. The list's `modules` array remains the single
 * source of truth for visibility.
 */
export function stripModuleGatedItemFields<
  T extends {
    completed?: boolean;
    completedAt?: string | null;
    completedBy?: string | null;
    position?: number | null;
  },
>(item: T, modules: readonly string[]): T {
  const next = { ...item };
  if (!hasModule(modules, "todo")) {
    delete next.completed;
    delete next.completedAt;
    delete next.completedBy;
  }
  if (!hasModule(modules, "ranking")) {
    delete next.position;
  }
  return next;
}
