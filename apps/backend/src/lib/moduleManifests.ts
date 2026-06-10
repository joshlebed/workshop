// Module manifests — per-module inspect hooks for `/config-preview` and
// `PATCH /v1/lists/:id`. Disabling a module never deletes data; the manifest
// reports the affected-row count so the client can render a confirmation.

import {
  type ConfigWarning,
  MODULE_NAMES,
  MODULE_REMOVAL_WARNINGS,
  type ModuleName,
} from "@workshop/shared/modules";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { itemScores, items, listSources } from "../db/schema.js";
import type { DbClient } from "./sql.js";

interface ModuleManifest {
  name: ModuleName;
  inspectRemoval: (listId: string, db: DbClient) => Promise<ConfigWarning[]>;
}

async function countItemsWith(
  listId: string,
  db: DbClient,
  where: ReturnType<typeof sql>,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(items)
    .where(and(eq(items.listId, listId), isNull(items.archivedAt), where));
  return Number(row?.count ?? 0);
}

const MODULE_MANIFESTS: Record<ModuleName, ModuleManifest> = {
  todo: {
    name: "todo",
    inspectRemoval: async (listId, db) => {
      const count = await countItemsWith(listId, db, sql`completed = true`);
      if (count === 0) return [];
      return [
        {
          code: MODULE_REMOVAL_WARNINGS.todo,
          message: `${count} completed item${count === 1 ? "" : "s"} will be hidden.`,
          affectedCount: count,
        },
      ];
    },
  },
  ranking: {
    name: "ranking",
    inspectRemoval: async (listId, db) => {
      const count = await countItemsWith(listId, db, isNotNull(items.position));
      if (count === 0) return [];
      return [
        {
          code: MODULE_REMOVAL_WARNINGS.ranking,
          message: `${count} item${count === 1 ? "" : "s"} will lose their manual order.`,
          affectedCount: count,
        },
      ];
    },
  },
  leaderboard: {
    name: "leaderboard",
    inspectRemoval: async (listId, db) => {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(itemScores)
        .innerJoin(items, eq(items.id, itemScores.itemId))
        .where(and(eq(items.listId, listId), isNull(items.archivedAt)));
      const count = Number(row?.count ?? 0);
      if (count === 0) return [];
      return [
        {
          code: MODULE_REMOVAL_WARNINGS.leaderboard,
          message: `${count} score${count === 1 ? "" : "s"} will be hidden.`,
          affectedCount: count,
        },
      ];
    },
  },
  sources: {
    name: "sources",
    inspectRemoval: async (listId, db) => {
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(listSources)
        .where(eq(listSources.listId, listId));
      const count = Number(row?.count ?? 0);
      if (count === 0) return [];
      return [
        {
          code: MODULE_REMOVAL_WARNINGS.sources,
          message: `${count} attached source${count === 1 ? "" : "s"} will stop syncing.`,
          affectedCount: count,
        },
      ];
    },
  },
  letterboxd: {
    name: "letterboxd",
    inspectRemoval: async (listId, db) => {
      // Pending suggestions are the data at risk: without the module they
      // surface as regular items and lose the accept flow.
      const count = await countItemsWith(listId, db, sql`suggestion_state = 'pending'`);
      if (count === 0) return [];
      return [
        {
          code: MODULE_REMOVAL_WARNINGS.letterboxd,
          message: `${count} pending suggestion${count === 1 ? "" : "s"} will become regular items.`,
          affectedCount: count,
        },
      ];
    },
  },
};

export async function inspectModuleChange(args: {
  listId: string;
  currentModules: readonly string[];
  nextModules: readonly string[];
  db: DbClient;
}): Promise<ConfigWarning[]> {
  const removed = args.currentModules.filter((m) => !args.nextModules.includes(m));
  const warnings: ConfigWarning[] = [];
  for (const moduleName of removed) {
    if ((MODULE_NAMES as readonly string[]).includes(moduleName)) {
      const manifest = MODULE_MANIFESTS[moduleName as ModuleName];
      warnings.push(...(await manifest.inspectRemoval(args.listId, args.db)));
    }
  }
  return warnings;
}
