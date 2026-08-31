// Integration tests for the user-flags surface (`GET/PUT /v1/users/me/flags`)
// — real SQL against in-memory PGlite with the actual drizzle/ migrations
// applied (same harness as games.test.ts), because the acceptance criteria are
// DB behaviors: upsert-in-place and per-user scoping.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";
import { userFlagKeySchema, userFlagValueSchema } from "../../lib/userFlags.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the mock so the router's `getDb` resolves to PGlite.
import { userRoutes } from "./users.js";

const userId = "00000000-0000-4000-8000-000000000011";
const otherUserId = "00000000-0000-4000-8000-000000000012";

function authHeaders(asUser = userId): Record<string, string> {
  return {
    Authorization: `Bearer ${signSession(asUser)}`,
    "Content-Type": "application/json",
  };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function getFlags(asUser = userId): Promise<Record<string, unknown>> {
  const res = await userRoutes.request("/me/flags", { headers: authHeaders(asUser) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { flags: Record<string, unknown> }).flags;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'flags-tester@example.com', 'Flags Tester'),
       ($2, 'flags-other@example.com', 'Flags Other')`,
    [userId, otherUserId],
  );
}, 60_000);

describe("GET /v1/users/me/flags", () => {
  it("returns an empty map for a user with no flags", async () => {
    expect(await getFlags()).toEqual({});
  });
});

describe("PUT /v1/users/me/flags/:key", () => {
  it("sets a flag, upserts in place on re-write, and scopes reads to the caller", async () => {
    const first = await userRoutes.request("/me/flags/games.share-sheet-announcement", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ value: { dismissedAt: "2026-08-31T00:00:00.000Z" } }),
    });
    expect(first.status).toBe(200);
    expect(await getFlags()).toEqual({
      "games.share-sheet-announcement": { dismissedAt: "2026-08-31T00:00:00.000Z" },
    });

    // Re-write replaces the value — still one row.
    const second = await userRoutes.request("/me/flags/games.share-sheet-announcement", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ value: { completedAt: "2026-08-31T01:00:00.000Z" } }),
    });
    expect(second.status).toBe(200);
    expect(await getFlags()).toEqual({
      "games.share-sheet-announcement": { completedAt: "2026-08-31T01:00:00.000Z" },
    });
    const count = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM user_flags WHERE user_id = $1`,
      [userId],
    );
    expect(count[0]?.n).toBe(1);

    // Another user sees none of it.
    expect(await getFlags(otherUserId)).toEqual({});
  });

  it("rejects an invalid key", async () => {
    const res = await userRoutes.request("/me/flags/Not%20A%20Key!", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ value: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a missing value and an oversized value", async () => {
    const missing = await userRoutes.request("/me/flags/games.x", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const oversized = await userRoutes.request("/me/flags/games.x", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ value: "x".repeat(3000) }),
    });
    expect(oversized.status).toBe(400);
  });
});

describe("flag validation schemas", () => {
  it("accepts dot-namespaced lowercase keys and rejects the rest", () => {
    expect(userFlagKeySchema.safeParse("games.share-extension-score").success).toBe(true);
    expect(userFlagKeySchema.safeParse("a").success).toBe(true);
    expect(userFlagKeySchema.safeParse("").success).toBe(false);
    expect(userFlagKeySchema.safeParse(".leading-dot").success).toBe(false);
    expect(userFlagKeySchema.safeParse("Upper.Case").success).toBe(false);
    expect(userFlagKeySchema.safeParse(`k${"x".repeat(64)}`).success).toBe(false);
  });

  it("accepts any small JSON value including null, rejects undefined", () => {
    expect(userFlagValueSchema.safeParse(null).success).toBe(true);
    expect(userFlagValueSchema.safeParse({ a: 1 }).success).toBe(true);
    expect(userFlagValueSchema.safeParse(undefined).success).toBe(false);
  });
});
