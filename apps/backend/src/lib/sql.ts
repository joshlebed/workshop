import type { sql } from "drizzle-orm";

/**
 * Drizzle's `db.execute(sql)` returns either an array (postgres-js driver) or
 * `{ rows }` (node-postgres driver). Every raw-SQL caller in the backend has
 * been normalising that the same way; this helper centralises the coercion
 * and the cast to a typed row shape.
 */
export interface SqlExecutor {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
}

export async function executeRows<TRow = Record<string, unknown>>(
  db: SqlExecutor,
  query: ReturnType<typeof sql>,
): Promise<TRow[]> {
  const rows = (await db.execute(query)) as TRow[] | { rows: TRow[] };
  return Array.isArray(rows) ? rows : rows.rows;
}
