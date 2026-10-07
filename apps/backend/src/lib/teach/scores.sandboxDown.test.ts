// An ordinary post while the sandbox is down: the teach write path asks the
// sandbox once and hands that answer to the code-parsing layer's fallback,
// rather than waiting out a second budget for the same non-answer.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DbGame } from "../../db/schema.js";

let testDb: ReturnType<typeof drizzle>;
vi.mock("../../db/client.js", () => ({ getDb: () => testDb }));

const scoreWithGameCode = vi.fn(async () => ({
  parseStatus: "failed" as const,
  scoreValue: null,
  scoreSummary: null,
  parse: { kind: "failed" as const, reason: "sandbox_unavailable" as const },
  format: null,
}));
vi.mock("../gameCode/scoring.js", async (original) => ({
  ...(await original<typeof import("../gameCode/scoring.js")>()),
  scoreWithGameCode: () => scoreWithGameCode(),
}));

import { saveScore } from "./scores.js";

// A Games beta account: code parsing and teach are on for it.
const josh = "b9a84203-b2c6-47a6-9fba-e41c2e10cffd";

async function rows<T>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(`INSERT INTO users (id, email, display_name) VALUES ($1, 'j@example.com', 'Josh')`, [
    josh,
  ]);
}, 60_000);

describe("saveScore with the sandbox down", () => {
  it("asks the sandbox once and keeps the legacy spec's reading", async () => {
    const { games } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const [wordle] = (await testDb
      .select()
      .from(games)
      .where(eq(games.gameKey, "wordle"))) as DbGame[];
    if (!wordle) throw new Error("no seeded Wordle");

    const { row, teach } = await saveScore({
      context: {},
      userId: josh,
      game: wordle,
      periodKey: "2026-10-06",
      raw: "Wordle 1,573 4/6\n\n🟩🟩🟩🟩🟩",
    });

    expect(scoreWithGameCode).toHaveBeenCalledTimes(1);
    expect(teach).toBeNull();
    // The code-parsing layer's rule for a sandbox that did not answer: the
    // registry spec's value, stored as a legacy-shaped row.
    expect(row).toMatchObject({ scoreValue: "4", parseStatus: null, scoreSource: null });
  });
});
