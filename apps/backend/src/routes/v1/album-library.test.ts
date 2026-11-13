import { PGlite } from "@electric-sql/pglite";
import type { AlbumLibraryAlbum, AlbumLibraryResponse } from "@workshop/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { albumLibraryImportSchema, importAlbumLibrary } from "../../lib/albumLibrary.js";
import { adminRoutes } from "./admin.js";

const adminId = "00000000-0000-4000-8000-000000000701";
const otherId = "00000000-0000-4000-8000-000000000702";

function album(id: string, over: Partial<AlbumLibraryAlbum> = {}): AlbumLibraryAlbum {
  return {
    id,
    name: `Album ${id}`,
    artists: ["Artist"],
    year: 2019,
    savedAt: "2021-03-04T05:06:07.000Z",
    albumType: "album",
    trackCount: 10,
    label: "Label",
    popularity: 50,
    imageUrl: "https://img.test/300.jpg",
    imageSmallUrl: "https://img.test/64.jpg",
    spotifyUrl: `https://open.spotify.com/album/${id}`,
    genre: "indie",
    subgenre: "dream pop",
    vibes: ["dreamy", "warm", "nostalgic"],
    energy: 40,
    mood: 60,
    tags: ["dream pop"],
    tagsKnown: true,
    ...over,
  };
}

async function fetchLibrary(asUser: string) {
  const res = await adminRoutes.request("/album-library", {
    headers: { Authorization: `Bearer ${signSession(asUser)}` },
  });
  return { status: res.status, body: (await res.json()) as AlbumLibraryResponse };
}

describe("GET /v1/admin/album-library", () => {
  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    resetConfigForTesting();

    testDb = drizzle(new PGlite());
    await migrate(testDb, { migrationsFolder: "./drizzle" });
    const client = (testDb as unknown as { $client: PGlite }).$client;
    await client.query(
      `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh'), ($2, 'other@example.com', 'Other')`,
      [adminId, otherId],
    );
  });

  it("refuses a non-admin", async () => {
    expect((await fetchLibrary(otherId)).status).toBe(403);
  });

  it("returns the admin's imported albums, most recently saved first", async () => {
    await importAlbumLibrary(adminId, [
      album("a1"),
      album("a2", { savedAt: "2024-01-01T00:00:00.000Z", genre: null, tagsKnown: false }),
    ]);
    const { status, body } = await fetchLibrary(adminId);
    expect(status).toBe(200);
    expect(body.albums.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(body.albums[1]).toEqual(album("a1"));
    expect(body.albums[0]?.genre).toBeNull();
  });

  it("re-import replaces the library and keeps other users' rows", async () => {
    await importAlbumLibrary(otherId, [album("a1"), album("b1")]);
    const result = await importAlbumLibrary(adminId, [album("a1", { name: "Renamed" })]);
    expect(result).toEqual({ albums: 1, removed: 1 });
    const { body } = await fetchLibrary(adminId);
    expect(body.albums.map((a) => a.name)).toEqual(["Renamed"]);
    // The other user is not an admin, so read their rows straight from the tables.
    const client = (testDb as unknown as { $client: PGlite }).$client;
    const rows = await client.query(
      "SELECT spotify_album_id FROM spotify_library_albums WHERE user_id = $1 ORDER BY 1",
      [otherId],
    );
    expect(rows.rows).toEqual([{ spotify_album_id: "a1" }, { spotify_album_id: "b1" }]);
  });

  it("saves picked albums as an album list, in the order given", async () => {
    await importAlbumLibrary(adminId, [album("a1"), album("a2"), album("a3")]);
    const post = (asUser: string, body: unknown) =>
      adminRoutes.request("/album-library/lists", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${signSession(asUser)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect((await post(otherId, { name: "Nope", albumIds: ["a1"] })).status).toBe(403);
    expect((await post(adminId, { name: "Nope", albumIds: ["not-mine"] })).status).toBe(400);

    const res = await post(adminId, { name: " Late night ", albumIds: ["a3", "zzz", "a1", "a3"] });
    expect(res.status).toBe(201);
    const { listId, added } = (await res.json()) as { listId: string; added: number };
    expect(added).toBe(2);
    const client = (testDb as unknown as { $client: PGlite }).$client;
    const list = await client.query("SELECT name, item_kind, owner_id FROM lists WHERE id = $1", [
      listId,
    ]);
    expect(list.rows).toEqual([
      { name: "Late night", item_kind: "spotify_album", owner_id: adminId },
    ]);
    const rows = await client.query(
      `SELECT kind, content->>'spotifyAlbumId' AS album, content->>'artist' AS artist
       FROM items WHERE list_id = $1 ORDER BY position`,
      [listId],
    );
    expect(rows.rows).toEqual([
      { kind: "spotify_album", album: "a3", artist: "Artist" },
      { kind: "spotify_album", album: "a1", artist: "Artist" },
    ]);
    const members = await client.query(
      "SELECT user_id, role FROM list_members WHERE list_id = $1",
      [listId],
    );
    expect(members.rows).toEqual([{ user_id: adminId, role: "owner" }]);
  });

  it("rejects an import file with an out-of-range score", () => {
    expect(albumLibraryImportSchema.safeParse([album("x", { energy: 140 })]).success).toBe(false);
    expect(albumLibraryImportSchema.safeParse([album("x")]).success).toBe(true);
  });
});
