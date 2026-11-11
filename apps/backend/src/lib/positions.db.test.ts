// DB-backed tests for `moveItemPosition` on an in-memory PGlite Postgres with
// the real migrations applied. The pure allocator math lives in
// positions.test.ts; this file covers the wire-level ambiguity of a
// neighbour-less move (demote vs. "rank it in an empty section").

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { moveItemPosition, POSITION_SPACING } from "./positions.js";
import type { DbClient } from "./sql.js";

let testDb: ReturnType<typeof drizzle>;
// PGlite's drizzle instance differs from postgres-js's only in transaction
// result types; the allocator never opens one.
let db: DbClient;

const userId = "00000000-0000-4000-8000-000000000001";
const listId = "00000000-0000-4000-8000-000000000010";
const itemA = "00000000-0000-4000-8000-0000000000a1";
const itemB = "00000000-0000-4000-8000-0000000000a2";
const itemC = "00000000-0000-4000-8000-0000000000a3";

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function positionOf(id: string): Promise<number | null> {
  const [row] = await rows<{ position: number | null }>(
    `SELECT position FROM items WHERE id = $1`,
    [id],
  );
  return row?.position ?? null;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  const pglite = new PGlite();
  testDb = drizzle(pglite);
  db = testDb as unknown as DbClient;
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(`INSERT INTO users (id, email, display_name) VALUES ($1, 'u@example.com', 'U')`, [
    userId,
  ]);
  await rows(
    `INSERT INTO lists (id, name, emoji, color, owner_id, modules, share_slug)
     VALUES ($1, 'Ranked', '📝', 'violet', $2, '{ranking}', 'ranked-slug')`,
    [listId, userId],
  );
  await rows(
    `INSERT INTO items (id, list_id, title, added_by) VALUES
       ($1, $4, 'A', $5), ($2, $4, 'B', $5), ($3, $4, 'C', $5)`,
    [itemA, itemB, itemC, listId, userId],
  );
});

describe("moveItemPosition with no neighbours", () => {
  it("demotes (position = NULL) when `ordered` is not set", async () => {
    await rows(`UPDATE items SET position = 5000 WHERE id = $1`, [itemC]);
    const res = await moveItemPosition({ listId, itemId: itemC, db });
    expect(res.position).toBeNull();
    expect(await positionOf(itemC)).toBeNull();
  });

  it("ranks the first item of an empty Ranked section when `ordered: true`", async () => {
    expect(
      await rows(`SELECT 1 FROM items WHERE list_id = $1 AND position IS NOT NULL`, [listId]),
    ).toHaveLength(0);
    const res = await moveItemPosition({ listId, itemId: itemA, ordered: true, db });
    expect(res.position).toBe(POSITION_SPACING);
    expect(await positionOf(itemA)).toBe(POSITION_SPACING);
  });

  it("appends after the last ranked row when the section is non-empty", async () => {
    const res = await moveItemPosition({ listId, itemId: itemB, ordered: true, db });
    expect(res.position).toBe(POSITION_SPACING * 2);
    expect(await positionOf(itemA)).toBe(POSITION_SPACING);
  });

  it("`ordered: true` is ignored when a neighbour is named", async () => {
    // Before A → placed above A, i.e. a smaller position than A's.
    const res = await moveItemPosition({
      listId,
      itemId: itemC,
      afterItemId: itemA,
      ordered: true,
      db,
    });
    expect(res.position).not.toBeNull();
    expect(res.position as number).toBeLessThan(POSITION_SPACING);
  });
});
