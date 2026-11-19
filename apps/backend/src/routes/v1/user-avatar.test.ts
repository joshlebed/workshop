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
    expect(res.headers.get("cache-control")).toBe(
      "private, max-age=60, stale-while-revalidate=604800",
    );
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("caches a URL carrying the current version for good", async () => {
    const first = await publicUserRoutes.request(`/${userWithAvatar}/avatar`);
    const version = first.headers.get("etag")?.replaceAll('"', "");
    expect(version).toHaveLength(8);

    const current = await publicUserRoutes.request(`/${userWithAvatar}/avatar?v=${version}`);
    expect(current.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    const stale = await publicUserRoutes.request(`/${userWithAvatar}/avatar?v=00000000`);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe(
      "private, max-age=60, stale-while-revalidate=604800",
    );
  });

  it("answers a matching If-None-Match with 304 and no body", async () => {
    const first = await publicUserRoutes.request(`/${userWithAvatar}/avatar`);
    const etag = first.headers.get("etag") ?? "";

    const res = await publicUserRoutes.request(`/${userWithAvatar}/avatar`, {
      headers: { "If-None-Match": etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it("answers a re-check without reading the picture, and serves a changed one", async () => {
    const other = "00000000-0000-4000-8000-000000000023";
    await rows(
      `INSERT INTO users (id, email, display_name, avatar_url) VALUES
       ($1, 'changing@example.com', 'Changing', 'data:image/png;base64,AQID')`,
      [other],
    );
    const first = await publicUserRoutes.request(`/${other}/avatar`);
    const etag = first.headers.get("etag") ?? "";

    const select = vi.spyOn(testDb, "select");
    const recheck = await publicUserRoutes.request(`/${other}/avatar`, {
      headers: { "If-None-Match": etag },
    });
    expect(recheck.status).toBe(304);
    expect(select).toHaveBeenCalledTimes(1);
    select.mockRestore();

    await rows(`UPDATE users SET avatar_url = 'data:image/jpeg;base64,BAUG' WHERE id = $1`, [
      other,
    ]);
    const changed = await publicUserRoutes.request(`/${other}/avatar`, {
      headers: { "If-None-Match": etag },
    });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await changed.arrayBuffer())).toEqual(Buffer.from([4, 5, 6]));
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
