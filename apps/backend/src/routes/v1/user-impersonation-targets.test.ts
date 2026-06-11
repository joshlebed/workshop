import { PGlite } from "@electric-sql/pglite";
import type { ImpersonationTargetsResponse } from "@workshop/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { userRoutes } from "./users.js";

const adminId = "00000000-0000-4000-8000-000000000501";
const betaId = "00000000-0000-4000-8000-000000000502";
const alphaId = "00000000-0000-4000-8000-000000000503";
const noEmailId = "00000000-0000-4000-8000-000000000504";

function authHeaders(asUser: string): Record<string, string> {
  return {
    Authorization: `Bearer ${signSession(asUser)}`,
    "Content-Type": "application/json",
  };
}

async function rows(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  await client.query(query, params);
}

describe("GET /v1/users/impersonation-targets", () => {
  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    resetConfigForTesting();

    const pglite = new PGlite();
    testDb = drizzle(pglite);
    await migrate(testDb, { migrationsFolder: "./drizzle" });

    await rows(
      `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh'),
       ($2, 'beta@example.com', 'Beta'),
       ($3, 'alpha@example.com', 'Alpha'),
       ($4, NULL, 'No Email')`,
      [adminId, betaId, alphaId, noEmailId],
    );
  }, 60_000);

  it("returns email-bearing targets sorted by email for admins", async () => {
    const res = await userRoutes.request("/impersonation-targets", {
      headers: authHeaders(adminId),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ImpersonationTargetsResponse;
    expect(body.users).toEqual([
      { id: alphaId, email: "alpha@example.com", displayName: "Alpha" },
      { id: betaId, email: "beta@example.com", displayName: "Beta" },
    ]);
  });

  it("rejects non-admin users", async () => {
    const res = await userRoutes.request("/impersonation-targets", {
      headers: authHeaders(betaId),
    });

    expect(res.status).toBe(403);
  });
});
