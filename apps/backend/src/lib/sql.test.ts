import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { executeRows, type SqlExecutor } from "./sql.js";

function fakeDb(result: unknown): SqlExecutor {
  return { execute: async () => result };
}

describe("executeRows", () => {
  it("returns the array as-is when the driver returns an array (postgres-js shape)", async () => {
    const db = fakeDb([{ a: 1 }, { a: 2 }]);
    const rows = await executeRows<{ a: number }>(db, sql`SELECT 1`);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("unwraps `rows` when the driver returns { rows } (node-postgres shape)", async () => {
    const db = fakeDb({ rows: [{ a: 1 }] });
    const rows = await executeRows<{ a: number }>(db, sql`SELECT 1`);
    expect(rows).toEqual([{ a: 1 }]);
  });

  it("returns an empty array for an empty postgres-js response", async () => {
    const db = fakeDb([]);
    const rows = await executeRows(db, sql`SELECT 1`);
    expect(rows).toEqual([]);
  });

  it("returns an empty array for an empty node-postgres response", async () => {
    const db = fakeDb({ rows: [] });
    const rows = await executeRows(db, sql`SELECT 1`);
    expect(rows).toEqual([]);
  });
});
