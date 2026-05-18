import type { sql } from "drizzle-orm";
import type { getDb } from "../db/client.js";

/**
 * Narrow interface for raw-SQL callers — only `.execute(sql)` is required.
 * Useful for unit tests that mock the drizzle client. Returns either an
 * array (postgres-js driver) or `{ rows }` (node-postgres driver).
 */
export interface SqlExecutor {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
}

/**
 * Full drizzle client (or transaction proxy) — exposes typed `.select`,
 * `.insert`, `.update`, `.delete` in addition to `.execute`. Use this when
 * the helper needs structured queries.
 */
export type DbClient =
  | ReturnType<typeof getDb>
  | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function executeRows<TRow = Record<string, unknown>>(
  db: SqlExecutor,
  query: ReturnType<typeof sql>,
): Promise<TRow[]> {
  const rows = (await db.execute(query)) as TRow[] | { rows: TRow[] };
  return Array.isArray(rows) ? rows : rows.rows;
}
