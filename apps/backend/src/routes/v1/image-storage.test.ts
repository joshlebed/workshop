// Uploaded images end to end, on real SQL (PGlite) and the real local image
// driver (a temp directory, set in test-setup.ts): profile pictures, list
// cover photos, the image route, and the backfill of legacy inline pictures.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({ getDb: () => testDb }));
vi.mock("../../lib/discord.js", () => ({ notifyDiscord: vi.fn() }));

import { runImageBackfillJob } from "../../jobs/imageBackfill.js";
import { imageRoutes } from "./images.js";
import { listRoutes } from "./lists.js";
import { publicUserRoutes, userRoutes } from "./users.js";

const app = new Hono()
  .route("/v1/images", imageRoutes)
  .route("/v1/users", publicUserRoutes)
  .route("/v1/users", userRoutes)
  .route("/v1/lists", listRoutes);

const userId = "00000000-0000-4000-8000-000000000041";
const legacyUserId = "00000000-0000-4000-8000-000000000042";
const legacyListId = "00000000-0000-4000-8000-0000000000d1";
const PNG = "data:image/png;base64,AQID";
const JPEG = "data:image/jpeg;base64,BAUG";
const API = "http://api.test";

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

async function call<T>(method: string, path: string, body?: unknown, headers = {}) {
  const res = await app.request(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${signSession(userId)}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const onDisk = (key: string) => existsSync(join(process.env.IMAGE_STORAGE_DIR ?? "", key));
const keyOf = (url: string | null) => (url ?? "").replace(`${API}/v1/images/`, "");

async function fetchImage(url: string | null) {
  const res = await app.request(url ?? `${API}/v1/images/none`);
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    cache: res.headers.get("cache-control"),
    bytes: [...Buffer.from(await res.arrayBuffer())],
  };
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name, avatar_url) VALUES
       ($1, 'i@example.com', 'Imogen', NULL), ($2, 'l@example.com', 'Legacy', $3)`,
    [userId, legacyUserId, "data:image/webp;base64,BwgJ"],
  );
  await rows(
    `INSERT INTO lists (id, name, emoji, color, share_slug, owner_id, cover_photo_url)
     VALUES ($1, 'Legacy', '📝', 'ocean', 'legacy', $2, $3)`,
    [legacyListId, userId, "data:image/gif;base64,CgsM"],
  );
  await rows(`INSERT INTO list_members (list_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    legacyListId,
    userId,
  ]);
}, 60_000);

type UserBody = { user: { avatarUrl: string | null } };
type ListBody = { list: { id: string; coverPhotoUrl: string | null } };

describe("profile pictures", () => {
  it("stores an upload outside the database and serves it by an immutable URL", async () => {
    const { status, body } = await call<UserBody>("PATCH", "/v1/users/me", { avatarUrl: PNG });
    expect(status).toBe(200);
    const url = body.user.avatarUrl;
    expect(url).toMatch(new RegExp(`^${API}/v1/images/avatars/${userId}/[0-9a-f]{16}\\.png$`));
    expect(await rows(`SELECT avatar_url, avatar_key FROM users WHERE id = $1`, [userId])).toEqual([
      { avatar_url: null, avatar_key: keyOf(url) },
    ]);
    expect(await fetchImage(url)).toEqual({
      status: 200,
      type: "image/png",
      cache: "public, max-age=31536000, immutable",
      bytes: [1, 2, 3],
    });
    // The per-user route other screens use serves the same picture.
    const byUser = await fetchImage(`${API}/v1/users/${userId}/avatar`);
    expect(byUser).toMatchObject({ status: 200, type: "image/png", bytes: [1, 2, 3] });
  });

  it("treats its own URL as unchanged, replaces on a new upload, and clears on null", async () => {
    const before = (await call<UserBody>("PATCH", "/v1/users/me", { avatarUrl: PNG })).body.user
      .avatarUrl;
    const same = await call<UserBody>("PATCH", "/v1/users/me", { avatarUrl: before });
    expect(same.status).toBe(200);
    expect(same.body.user.avatarUrl).toBe(before);
    expect(onDisk(keyOf(before))).toBe(true);

    const next = (await call<UserBody>("PATCH", "/v1/users/me", { avatarUrl: JPEG })).body.user
      .avatarUrl;
    expect(next).toMatch(/\.jpg$/);
    expect(onDisk(keyOf(before))).toBe(false);
    expect(onDisk(keyOf(next))).toBe(true);

    const cleared = await call<UserBody>("PATCH", "/v1/users/me", { avatarUrl: null });
    expect(cleared.body.user.avatarUrl).toBeNull();
    expect(onDisk(keyOf(next))).toBe(false);
    expect((await fetchImage(`${API}/v1/users/${userId}/avatar`)).status).toBe(404);
  });

  it("rejects a URL that is not the current picture", async () => {
    const res = await call("PATCH", "/v1/users/me", { avatarUrl: "https://example.com/a.png" });
    expect(res.status).toBe(400);
  });

  it("builds the URL from the dev proxy's public base when it says so", async () => {
    const { body } = await call<UserBody>(
      "PATCH",
      "/v1/users/me",
      { avatarUrl: PNG },
      { "X-Workshop-Public-Base": "https://preview.example/api" },
    );
    expect(body.user.avatarUrl).toMatch(/^https:\/\/preview\.example\/api\/v1\/images\/avatars\//);
    await call("PATCH", "/v1/users/me", { avatarUrl: null });
  });
});

describe("list cover photos", () => {
  it("stores a cover on create, replaces it, copies it for a duplicate, and clears it", async () => {
    const created = await call<ListBody>("POST", "/v1/lists", {
      name: "Covered",
      emoji: "📝",
      color: "ocean",
      itemKind: "plain",
      modules: [],
      coverPhotoUrl: PNG,
    });
    expect(created.status).toBe(201);
    const { id, coverPhotoUrl: first } = created.body.list;
    expect(first).toMatch(new RegExp(`^${API}/v1/images/list-covers/${id}/[0-9a-f]{16}\\.png$`));
    expect(await rows(`SELECT cover_photo_url FROM lists WHERE id = $1`, [id])).toEqual([
      { cover_photo_url: null },
    ]);
    expect((await fetchImage(first)).bytes).toEqual([1, 2, 3]);

    // `GET /v1/lists` carries the same URL.
    const home = await call<{ lists: ListBody["list"][] }>("GET", "/v1/lists");
    expect(home.body.lists.find((l) => l.id === id)?.coverPhotoUrl).toBe(first);

    const dup = await call<ListBody>("POST", `/v1/lists/${id}/duplicate`, {});
    expect(dup.status).toBe(201);
    const copy = dup.body.list.coverPhotoUrl;
    expect(copy).toContain(`/list-covers/${dup.body.list.id}/`);
    expect((await fetchImage(copy)).bytes).toEqual([1, 2, 3]);

    const replaced = await call<ListBody>("PATCH", `/v1/lists/${id}`, { coverPhotoUrl: JPEG });
    expect(replaced.body.list.coverPhotoUrl).toMatch(/\.jpg$/);
    expect(onDisk(keyOf(first))).toBe(false);
    // The duplicate keeps its own copy.
    expect((await fetchImage(copy)).status).toBe(200);

    const cleared = await call<ListBody>("PATCH", `/v1/lists/${id}`, { coverPhotoUrl: null });
    expect(cleared.body.list.coverPhotoUrl).toBeNull();
    expect(onDisk(keyOf(replaced.body.list.coverPhotoUrl))).toBe(false);
  });
});

describe("GET /v1/images", () => {
  it("404s anything that is not a well-formed key", async () => {
    for (const path of [
      "/v1/images/avatars/not-a-uuid/0123456789abcdef.png",
      `/v1/images/secrets/${userId}/0123456789abcdef.png`,
      `/v1/images/avatars/${userId}/..%2F..%2Fetc.png`,
      `/v1/images/avatars/${userId}/0123456789abcdef.png`,
    ]) {
      expect((await app.request(`${API}${path}`)).status).toBe(404);
    }
  });
});

describe("image backfill", () => {
  it("serves legacy inline pictures untouched before the backfill", async () => {
    const avatar = await fetchImage(`${API}/v1/users/${legacyUserId}/avatar`);
    expect(avatar).toMatchObject({ status: 200, type: "image/webp", bytes: [7, 8, 9] });
    const home = await call<{ lists: ListBody["list"][] }>("GET", "/v1/lists");
    expect(home.body.lists.find((l) => l.id === legacyListId)?.coverPhotoUrl).toBe(
      "data:image/gif;base64,CgsM",
    );
  });

  it("reports in a dry run, then moves both kinds and is safe to re-run", async () => {
    expect(await runImageBackfillJob({ dryRun: true })).toEqual({
      dryRun: true,
      moved: 2,
      unreadable: 0,
      remaining: 2,
    });
    expect(await runImageBackfillJob()).toEqual({
      dryRun: false,
      moved: 2,
      unreadable: 0,
      remaining: 0,
    });

    const [user] = await rows<{ avatar_url: string | null; avatar_key: string }>(
      `SELECT avatar_url, avatar_key FROM users WHERE id = $1`,
      [legacyUserId],
    );
    expect(user?.avatar_url).toBeNull();
    expect(await fetchImage(`${API}/v1/images/${user?.avatar_key}`)).toMatchObject({
      type: "image/webp",
      bytes: [7, 8, 9],
    });
    const home = await call<{ lists: ListBody["list"][] }>("GET", "/v1/lists");
    const cover = home.body.lists.find((l) => l.id === legacyListId)?.coverPhotoUrl ?? null;
    expect(cover).toContain(`/v1/images/list-covers/${legacyListId}/`);
    expect(await fetchImage(cover)).toMatchObject({ type: "image/gif", bytes: [10, 11, 12] });

    expect(await runImageBackfillJob()).toMatchObject({ moved: 0, remaining: 0 });
  });

  it("leaves a row alone when its inline value is not a picture", async () => {
    await rows(`UPDATE users SET avatar_url = 'not a picture', avatar_key = NULL WHERE id = $1`, [
      legacyUserId,
    ]);
    expect(await runImageBackfillJob()).toMatchObject({ moved: 0, unreadable: 1, remaining: 1 });
    await rows(`UPDATE users SET avatar_url = NULL WHERE id = $1`, [legacyUserId]);
  });
});
