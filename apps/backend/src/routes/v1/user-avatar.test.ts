import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { publicUserRoutes } from "./users.js";

const userWithAvatar = "00000000-0000-4000-8000-000000000021";
const userWithoutAvatar = "00000000-0000-4000-8000-000000000022";

async function rows(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  await client.query(query, params);
}

describe("GET /v1/users/:id/avatar", () => {
  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);

    const pglite = new PGlite();
    testDb = drizzle(pglite);
    await migrate(testDb, { migrationsFolder: "./drizzle" });

    await rows(
      `INSERT INTO users (id, email, display_name, avatar_url) VALUES
       ($1, 'avatar@example.com', 'Avatar', 'data:image/png;base64,AQID'),
       ($2, 'plain@example.com', 'Plain', NULL)`,
      [userWithAvatar, userWithoutAvatar],
    );
  });

  it("serves the stored profile picture as an image response", async () => {
    const res = await publicUserRoutes.request(`/${userWithAvatar}/avatar`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("404s when the user has no profile picture", async () => {
    const res = await publicUserRoutes.request(`/${userWithoutAvatar}/avatar`);

    expect(res.status).toBe(404);
  });

  it("404s invalid user ids", async () => {
    const res = await publicUserRoutes.request("/not-a-user/avatar");

    expect(res.status).toBe(404);
  });
});
