import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";

let testDb: ReturnType<typeof drizzle>;
vi.mock("../db/client.js", () => ({ getDb: () => testDb }));

import {
  parseInsightsTimestamp,
  rollupWindow,
  runRequestRollupJob,
  toRollupRows,
} from "./requestRollups.js";

async function rows(query: string) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query(query)).rows as Record<string, unknown>[];
}

describe("request rollups job", () => {
  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    resetConfigForTesting();
    testDb = drizzle(new PGlite());
    await migrate(testDb, { migrationsFolder: "./drizzle" });
  }, 60_000);

  it("computes the last complete hours as the window", () => {
    const { start, end } = rollupWindow(new Date("2026-10-29T18:42:11Z"), 3);
    expect(end.toISOString()).toBe("2026-10-29T18:00:00.000Z");
    expect(start.toISOString()).toBe("2026-10-29T15:00:00.000Z");
  });

  it("parses Logs Insights bin timestamps as UTC", () => {
    expect(parseInsightsTimestamp("2026-10-29 17:00:00.000")?.toISOString()).toBe(
      "2026-10-29T17:00:00.000Z",
    );
    expect(parseInsightsTimestamp("garbage")).toBeNull();
  });

  it("maps result fields onto rollup rows with safe defaults", () => {
    const [row] = toRollupRows([
      {
        hour: "2026-10-29 17:00:00.000",
        client_app: "highscore",
        plat: "iOS",
        ver: "1.4.0",
        meth: "PUT",
        rt: "/v1/games/:id/scores",
        requests: "12",
        users: "3",
        errors: "0",
        avg_ms: "87.4",
      },
    ]);
    expect(row).toEqual({
      hour: new Date("2026-10-29T17:00:00Z"),
      client: "highscore",
      platform: "ios",
      appVersion: "1.4.0",
      method: "PUT",
      route: "/v1/games/:id/scores",
      requests: 12,
      users: 3,
      errors: 0,
      avgMs: 87,
    });
  });

  it("rewrites the window idempotently and drops rows outside it", async () => {
    const now = new Date("2026-10-29T18:42:11Z");
    const query = vi.fn(async () => [
      {
        hour: "2026-10-29 17:00:00.000",
        client_app: "workshop",
        plat: "web",
        ver: "0.6.0",
        meth: "GET",
        rt: "/v1/lists",
        requests: "5",
        users: "2",
        errors: "1",
        avg_ms: "40",
      },
      {
        // Outside [15:00, 18:00) — a partial-hour straggler the query may return.
        hour: "2026-10-29 18:00:00.000",
        client_app: "workshop",
        plat: "web",
        ver: "0.6.0",
        meth: "GET",
        rt: "/v1/lists",
        requests: "99",
        users: "9",
        errors: "0",
        avg_ms: "40",
      },
    ]);

    const first = await runRequestRollupJob({ now, query });
    expect(first).toEqual({
      windowStart: "2026-10-29T15:00:00.000Z",
      windowEnd: "2026-10-29T18:00:00.000Z",
      rows: 1,
    });
    expect(query).toHaveBeenCalledWith({
      start: new Date("2026-10-29T15:00:00Z"),
      end: new Date("2026-10-29T18:00:00Z"),
    });

    // Second run with changed numbers replaces, never duplicates.
    query.mockResolvedValueOnce([
      {
        hour: "2026-10-29 17:00:00.000",
        client_app: "workshop",
        plat: "web",
        ver: "0.6.0",
        meth: "GET",
        rt: "/v1/lists",
        requests: "7",
        users: "2",
        errors: "0",
        avg_ms: "41",
      },
    ]);
    await runRequestRollupJob({ now, query });
    const stored = await rows("SELECT requests, errors FROM request_rollups");
    expect(stored).toEqual([{ requests: 7, errors: 0 }]);
  });
});
