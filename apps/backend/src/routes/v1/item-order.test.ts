// Integration tests for the one-order list model (docs/list-types.md →
// "Order") on in-memory PGlite with the real migrations: every move a current
// client makes, every request shape a previous bundle still sends, new rows
// landing on top (single add and bulk paste), completion and delete Undo
// returning a row to its place, and the sync inbox on a list with a source
// (arrivals land in it through the real sync route, never disturbing placed
// rows; one move places a row; removing the last source folds it in).

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));
vi.mock("../../middleware/rate-limit.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<unknown>) => next(),
}));

// The real sync route runs; only Spotify's HTTP client is stubbed.
const fetchPlaylistAlbumExtractsMock = vi.fn();
vi.mock("../../lib/spotify/app-client.js", () => ({
  fetchPlaylistMeta: vi.fn(),
  fetchPlaylistAlbumExtracts: (...args: unknown[]) => fetchPlaylistAlbumExtractsMock(...args),
  PlaylistNotAvailableError: class PlaylistNotAvailableError extends Error {},
  SpotifyApiError: class SpotifyApiError extends Error {},
  SpotifyAuthError: class SpotifyAuthError extends Error {},
  SpotifyConfigError: class SpotifyConfigError extends Error {},
}));

// Imported after the mocks so the routers' `getDb` resolves to PGlite.
const { itemRoutes } = await import("./items.js");
const { listRoutes } = await import("./lists.js");
const { itemAcceptRoutes } = await import("./letterboxd.js");

const ownerId = "00000000-0000-4000-8000-000000000001";
const outsiderId = "00000000-0000-4000-8000-000000000002";
const friendId = "00000000-0000-4000-8000-000000000003";
const plainListId = "00000000-0000-4000-8000-0000000000b2";
const legacyListId = "00000000-0000-4000-8000-0000000000b1";
const shelfListId = "00000000-0000-4000-8000-0000000000b3";
const matchListId = "00000000-0000-4000-8000-0000000000b4";
const shelfSourceId = "00000000-0000-4000-8000-0000000000c3";

function headers(userId = ownerId): Record<string, string> {
  return { Authorization: `Bearer ${signSession(userId)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

interface WireItem {
  id: string;
  title: string;
  position: number | null;
}
interface WireSections {
  open: WireItem[];
  inbox: WireItem[];
  completed: WireItem[];
  ordered: WireItem[];
  unordered: WireItem[];
}

async function read(listId: string): Promise<WireSections> {
  const res = await listRoutes.request(`/${listId}/items`, { headers: headers() });
  expect(res.status).toBe(200);
  return (await res.json()) as WireSections;
}

const titlesOf = (items: WireItem[]) => items.map((i) => i.title);

async function open(listId: string): Promise<string[]> {
  return titlesOf((await read(listId)).open);
}

async function move(itemId: string, body: Record<string, unknown>, userId = ownerId) {
  return itemRoutes.request(`/${itemId}/move`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify(body),
  });
}

async function events(): Promise<string[]> {
  const r = await rows<{ event_type: string }>(
    `SELECT event_type FROM activity_events ORDER BY created_at, event_type`,
  );
  return r.map((e) => e.event_type);
}

async function add(listId: string, title: string): Promise<string> {
  const res = await listRoutes.request(`/${listId}/items`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { item: WireItem }).item.id;
}

/** Add rows through the API, oldest first: the list reads them newest first. */
async function addAll(listId: string, titles: string[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const t of titles) ids[t] = await add(listId, t);
  return ids;
}

let seq = 0;
/** Insert raw rows with no position, oldest first (pre-migration data, sync arrivals). */
async function seedUnplaced(
  listId: string,
  titles: string[],
  kind = "plain",
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const title of titles) {
    seq += 1;
    const [row] = await rows<{ id: string }>(
      `INSERT INTO items (list_id, title, kind, added_by, created_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval) RETURNING id`,
      [listId, title, kind, ownerId, String(10_000 - seq)],
    );
    if (!row) throw new Error("insert failed");
    ids[title] = row.id;
  }
  return ids;
}

function albums(titles: string[]) {
  return titles.map((t) => ({
    spotifyAlbumId: `id-${t}`,
    spotifyAlbumUrl: `https://open.spotify.com/album/id-${t}`,
    title: t,
    artist: "Artist",
    trackCount: 10,
  }));
}

async function syncShelf(): Promise<WireSections & { addedCount: number }> {
  const res = await listRoutes.request(`/${shelfListId}/sources/${shelfSourceId}/sync`, {
    method: "POST",
    headers: headers(),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as WireSections & { addedCount: number };
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.SPOTIFY_CLIENT_ID = "client";
  process.env.SPOTIFY_CLIENT_SECRET = "secret";
  resetConfigForTesting();

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'owner@example.com', 'Owner'), ($2, 'out@example.com', 'Out'),
       ($3, 'friend@example.com', 'Friend')`,
    [ownerId, outsiderId, friendId],
  );
});

beforeEach(async () => {
  await rows(`DELETE FROM activity_events`);
  await rows(`DELETE FROM items`);
  await rows(`DELETE FROM list_sources`);
  await rows(`DELETE FROM list_members`);
  await rows(`DELETE FROM lists`);
  await rows(
    `INSERT INTO lists (id, name, emoji, color, share_slug, owner_id, modules, item_kind) VALUES
       ($1, 'Plain', '📝', 'amber', 'plain', $5, '{todo}', 'plain'),
       ($2, 'Legacy', '🏆', 'amber', 'legacy', $5, '{todo,ranking}', 'plain'),
       ($3, 'Shelf', '📀', 'amber', 'shelf', $5, '{sources}', 'spotify_album'),
       ($4, 'Match', '🎬', 'amber', 'match', $5, '{sources,letterboxd}', 'movie')`,
    [plainListId, legacyListId, shelfListId, matchListId, ownerId],
  );
  await rows(
    `INSERT INTO list_members (list_id, user_id, role) VALUES
       ($1, $5, 'owner'), ($2, $5, 'owner'), ($3, $5, 'owner'), ($4, $5, 'owner'),
       ($4, $6, 'member')`,
    [plainListId, legacyListId, shelfListId, matchListId, ownerId, friendId],
  );
  await rows(
    `INSERT INTO list_sources (id, list_id, kind, config) VALUES
       ($1, $2, 'spotify_playlist', '{"spotifyPlaylistUrl":"https://open.spotify.com/playlist/p1","spotifyPlaylistId":"p1"}'),
       (gen_random_uuid(), $3, 'letterboxd_match', '{}')`,
    [shelfSourceId, shelfListId, matchListId],
  );
  fetchPlaylistAlbumExtractsMock.mockReset();
}, 60_000);

describe("one order: adding", () => {
  it("lands each new row at the top", async () => {
    await addAll(plainListId, ["A", "B", "C"]);
    expect(await open(plainListId)).toEqual(["C", "B", "A"]);
  });

  it("lands a new row at the top of a hand-arranged list without moving anything else", async () => {
    const ids = await addAll(plainListId, ["A", "B", "C"]);
    await move(ids.C ?? "", { section: "list", beforeItemId: ids.A });
    expect(await open(plainListId)).toEqual(["B", "A", "C"]);
    await add(plainListId, "New");
    expect(await open(plainListId)).toEqual(["New", "B", "A", "C"]);
  });

  it("lands a bulk paste at the top in the order it was pasted", async () => {
    await addAll(plainListId, ["Old"]);
    const res = await listRoutes.request(`/${plainListId}/items/bulk`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ items: [{ title: "One" }, { title: "Two" }, { title: "Three" }] }),
    });
    expect(res.status).toBe(201);
    expect(await open(plainListId)).toEqual(["One", "Two", "Three", "Old"]);
  });

  it("returns the legacy shape previous bundles read: no Ranked block, one plain list", async () => {
    await addAll(plainListId, ["A", "B"]);
    const s = await read(plainListId);
    expect(s.ordered).toEqual([]);
    expect(titlesOf(s.unordered)).toEqual(["B", "A"]);
    expect(s.inbox).toEqual([]);
    expect(s.open.every((i) => typeof i.position === "number")).toBe(true);
  });
});

describe("one order: moving", () => {
  const titles = ["A", "B", "C", "D"]; // reads D C B A

  it("moves a row between two neighbours and persists the whole order", async () => {
    const ids = await addAll(plainListId, titles);
    const res = await move(ids.A ?? "", {
      section: "list",
      beforeItemId: ids.D,
      afterItemId: ids.C,
    });
    expect(res.status).toBe(200);
    expect(await open(plainListId)).toEqual(["D", "A", "C", "B"]);
  });

  it("moves to just below `before`, to just above `after`, and to the top", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.D ?? "", { section: "list", beforeItemId: ids.A });
    expect(await open(plainListId)).toEqual(["C", "B", "A", "D"]);
    await move(ids.A ?? "", { section: "list", afterItemId: ids.C });
    expect(await open(plainListId)).toEqual(["A", "C", "B", "D"]);
    await move(ids.B ?? "", { section: "list" });
    expect(await open(plainListId)).toEqual(["B", "A", "C", "D"]);
  });

  it("writes no activity for a move inside the list", async () => {
    const ids = await addAll(plainListId, titles);
    await rows(`DELETE FROM activity_events`);
    await move(ids.A ?? "", { section: "list" });
    expect(await events()).toEqual([]);
  });

  it("renumbers when two neighbours have no room between them", async () => {
    const ids = await addAll(plainListId, titles);
    await rows(`UPDATE items SET position = 10 WHERE id = $1`, [ids.D]);
    await rows(`UPDATE items SET position = 11 WHERE id = $1`, [ids.C]);
    await rows(`UPDATE items SET position = 20 WHERE id = $1`, [ids.B]);
    await rows(`UPDATE items SET position = 30 WHERE id = $1`, [ids.A]);
    await move(ids.A ?? "", { section: "list", beforeItemId: ids.D, afterItemId: ids.C });
    expect(await open(plainListId)).toEqual(["D", "A", "C", "B"]);
  });

  it("lands between the two rows the person saw when a filter hides some in between", async () => {
    const ids = await addAll(plainListId, ["A", "B", "C", "D", "E"]); // E D C B A
    // Filter shows E, C, A; drop A between E and C (D is hidden in between).
    await move(ids.A ?? "", { section: "list", beforeItemId: ids.E, afterItemId: ids.C });
    const order = await open(plainListId);
    expect(order.indexOf("A")).toBeGreaterThan(order.indexOf("E"));
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("C"));
    expect(order.filter((t) => t !== "A")).toEqual(["E", "D", "C", "B"]);
  });

  it("ignores a neighbour from another list", async () => {
    const ids = await addAll(plainListId, ["A", "B"]);
    const other = await addAll(legacyListId, ["X"]);
    await move(ids.A ?? "", { section: "list", beforeItemId: other.X });
    expect(await open(plainListId)).toEqual(["A", "B"]);
  });

  it("returns a completed row to its old place when it is reopened", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.A ?? "", { section: "list", beforeItemId: ids.D, afterItemId: ids.C });
    await itemRoutes.request(`/${ids.A}/complete`, { method: "POST", headers: headers() });
    expect(await open(plainListId)).toEqual(["D", "C", "B"]);
    expect(titlesOf((await read(plainListId)).completed)).toEqual(["A"]);
    await itemRoutes.request(`/${ids.A}/uncomplete`, { method: "POST", headers: headers() });
    expect(await open(plainListId)).toEqual(["D", "A", "C", "B"]);
  });

  it("reads rows with no position (pre-migration data) at the top, newest first, and places them on the first move without reshuffling", async () => {
    const placed = await addAll(plainListId, ["P1", "P2"]); // P2 P1
    await seedUnplaced(plainListId, ["U1", "U2"]);
    expect(await open(plainListId)).toEqual(["U2", "U1", "P2", "P1"]);
    await move(placed.P1 ?? "", { section: "list", beforeItemId: placed.P2 });
    expect(await open(plainListId)).toEqual(["U2", "U1", "P2", "P1"]);
    const nulls = await rows(`SELECT 1 FROM items WHERE list_id = $1 AND position IS NULL`, [
      plainListId,
    ]);
    expect(nulls).toHaveLength(0);
  });

  it("404s a move for a non-member and 400s an unknown section", async () => {
    const ids = await addAll(plainListId, ["A"]);
    expect((await move(ids.A ?? "", { section: "list" }, outsiderId)).status).toBe(404);
    expect((await move(ids.A ?? "", { section: "sideways" })).status).toBe(400);
  });
});

describe("request shapes previous bundles send", () => {
  const titles = ["A", "B", "C", "D"]; // reads D C B A

  it("`section: unranked` with neighbours places in the one order", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.A ?? "", { section: "unranked", beforeItemId: ids.D, afterItemId: ids.C });
    expect(await open(plainListId)).toEqual(["D", "A", "C", "B"]);
  });

  it("`section: unranked` with no neighbours moves to the top", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.B ?? "", { section: "unranked" });
    expect(await open(plainListId)).toEqual(["B", "D", "C", "A"]);
  });

  it("`section: ranked` with neighbours places between them, on any list", async () => {
    const ids = await addAll(plainListId, titles);
    const res = await move(ids.A ?? "", {
      section: "ranked",
      beforeItemId: ids.C,
      afterItemId: ids.B,
    });
    expect(res.status).toBe(200);
    expect(await open(plainListId)).toEqual(["D", "C", "A", "B"]);
  });

  it("`section: ranked` with no neighbours (Rank at top / empty-Ranked drop) moves to the top", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.A ?? "", { section: "ranked", beforeItemId: null, afterItemId: null });
    expect(await open(plainListId)).toEqual(["A", "D", "C", "B"]);
  });

  it("`ordered: true` (legacy promote) moves to the top", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.B ?? "", { ordered: true });
    expect(await open(plainListId)).toEqual(["B", "D", "C", "A"]);
  });

  it("no section with neighbours places between them", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.D ?? "", { beforeItemId: ids.B, afterItemId: ids.A });
    expect(await open(plainListId)).toEqual(["C", "B", "D", "A"]);
  });

  it("the legacy demote (no section, no neighbours) changes nothing on a list without a source", async () => {
    const ids = await addAll(plainListId, titles);
    await move(ids.A ?? "", { section: "list", beforeItemId: ids.D });
    const res = await move(ids.A ?? "", {});
    expect(res.status).toBe(200);
    expect(await open(plainListId)).toEqual(["D", "A", "C", "B"]);
    expect(await events()).not.toContain("item_demoted");
  });

  it("a list that still has the `ranking` module behaves exactly the same", async () => {
    const ids = await addAll(legacyListId, titles);
    await move(ids.A ?? "", { section: "ranked", beforeItemId: ids.D, afterItemId: ids.C });
    const s = await read(legacyListId);
    expect(titlesOf(s.open)).toEqual(["D", "A", "C", "B"]);
    expect(s.ordered).toEqual([]);
  });
});

describe("undo of a delete", () => {
  async function del(itemId: string) {
    const res = await itemRoutes.request(`/${itemId}`, { method: "DELETE", headers: headers() });
    expect(res.status).toBe(200);
  }
  async function restore(itemId: string, userId = ownerId) {
    return itemRoutes.request(`/${itemId}/unarchive`, { method: "POST", headers: headers(userId) });
  }

  it("restores a deleted row to its old place and logs item_restored", async () => {
    const ids = await addAll(plainListId, ["A", "B", "C"]); // C B A
    await move(ids.A ?? "", { section: "list" }); // A C B
    await del(ids.C ?? "");
    expect(await open(plainListId)).toEqual(["A", "B"]);
    const res = await restore(ids.C ?? "");
    expect(res.status).toBe(200);
    expect(await open(plainListId)).toEqual(["A", "C", "B"]);
    expect((await events()).at(-1)).toBe("item_restored");
  });

  it("restores a row even after rows were added above it", async () => {
    const ids = await addAll(plainListId, ["A", "B"]); // B A
    await del(ids.A ?? "");
    await add(plainListId, "New");
    await restore(ids.A ?? "");
    expect(await open(plainListId)).toEqual(["New", "B", "A"]);
  });

  it("is idempotent for a live item and 404s a non-member", async () => {
    const ids = await addAll(plainListId, ["A"]);
    await rows(`DELETE FROM activity_events`);
    expect((await restore(ids.A ?? "")).status).toBe(200);
    expect(await events()).toEqual([]);
    await del(ids.A ?? "");
    expect((await restore(ids.A ?? "", outsiderId)).status).toBe(404);
  });
});

describe("the sync inbox on a list with a source", () => {
  it("puts sync arrivals in the inbox, newest first, and never moves placed rows", async () => {
    fetchPlaylistAlbumExtractsMock.mockResolvedValueOnce(albums(["Blonde", "Currents"]));
    const first = await syncShelf();
    expect(first.addedCount).toBe(2);
    expect(first.open).toEqual([]);
    expect(titlesOf(first.inbox).sort()).toEqual(["Blonde", "Currents"]);

    // Place both, in a chosen order.
    const byTitle = Object.fromEntries(first.inbox.map((i) => [i.title, i.id]));
    await move(byTitle.Currents ?? "", { section: "list" });
    await move(byTitle.Blonde ?? "", { section: "list", beforeItemId: byTitle.Currents });
    const placed = await read(shelfListId);
    expect(titlesOf(placed.open)).toEqual(["Currents", "Blonde"]);
    const before = await rows<{ id: string; position: number }>(
      `SELECT id, position FROM items WHERE list_id = $1 ORDER BY id`,
      [shelfListId],
    );

    // A later sync adds more; what was placed stays exactly where it was.
    fetchPlaylistAlbumExtractsMock.mockResolvedValueOnce(
      albums(["Blonde", "Currents", "Igor", "Lemonade"]),
    );
    const second = await syncShelf();
    expect(second.addedCount).toBe(2);
    expect(titlesOf(second.open)).toEqual(["Currents", "Blonde"]);
    expect(titlesOf(second.inbox).sort()).toEqual(["Igor", "Lemonade"]);
    const after = await rows<{ id: string; position: number }>(
      `SELECT id, position FROM items WHERE list_id = $1 AND position IS NOT NULL ORDER BY id`,
      [shelfListId],
    );
    expect(after).toEqual(before);
    // Previous bundles read the list then the inbox as one plain list.
    expect(titlesOf(second.unordered).slice(0, 2)).toEqual(["Currents", "Blonde"]);
    expect(second.ordered).toEqual([]);
  });

  it("reads the inbox newest detected first", async () => {
    const ids = await seedUnplaced(shelfListId, ["Old", "Mid", "New"], "spotify_album");
    const detected = { Old: "2026-01-01", Mid: "2026-02-01", New: "2026-03-01" };
    for (const [title, at] of Object.entries(detected)) {
      await rows(
        `UPDATE items SET content = jsonb_build_object('spotifyAlbumId', title, 'detectedAt', $2::text)
         WHERE id = $1`,
        [ids[title], `${at}T00:00:00.000Z`],
      );
    }
    expect(titlesOf((await read(shelfListId)).inbox)).toEqual(["New", "Mid", "Old"]);
  });

  it("places an inbox row between two list rows and logs it once", async () => {
    const ids = await seedUnplaced(shelfListId, ["A", "B", "C"], "spotify_album");
    await move(ids.A ?? "", { section: "list" });
    await move(ids.B ?? "", { section: "list", beforeItemId: ids.A });
    await rows(`DELETE FROM activity_events`);
    await move(ids.C ?? "", { section: "list", beforeItemId: ids.A, afterItemId: ids.B });
    const s = await read(shelfListId);
    expect(titlesOf(s.open)).toEqual(["A", "C", "B"]);
    expect(s.inbox).toEqual([]);
    expect(await events()).toEqual(["item_promoted"]);
    // Moving it again inside the list is silent.
    await move(ids.C ?? "", { section: "list" });
    expect(await events()).toEqual(["item_promoted"]);
  });

  it("“Add to list” (no neighbours) puts an inbox row at the top of the list", async () => {
    const ids = await seedUnplaced(shelfListId, ["A", "B"], "spotify_album");
    await move(ids.A ?? "", { section: "list" });
    await move(ids.B ?? "", { section: "list" });
    expect(titlesOf((await read(shelfListId)).open)).toEqual(["B", "A"]);
  });

  it("the legacy demote returns a placed row to the inbox (the shelf's old “Remove from order”)", async () => {
    const ids = await seedUnplaced(shelfListId, ["A", "B"], "spotify_album");
    await move(ids.A ?? "", { ordered: true });
    expect(titlesOf((await read(shelfListId)).open)).toEqual(["A"]);
    await move(ids.A ?? "", {});
    const s = await read(shelfListId);
    expect(s.open).toEqual([]);
    expect(titlesOf(s.inbox)).toEqual(["B", "A"]);
    expect(await events()).toContain("item_demoted");
  });

  it("puts a row a person adds on a synced list at the top of the list, not in the inbox", async () => {
    await seedUnplaced(matchListId, ["Synced"], "movie");
    await add(matchListId, "Mine");
    const s = await read(matchListId);
    expect(titlesOf(s.open)).toEqual(["Mine"]);
    expect(titlesOf(s.inbox)).toEqual(["Synced"]);
  });

  it("puts an accepted suggestion at the top of the list", async () => {
    const placed = await addAll(matchListId, ["Placed"]);
    const [pending] = await rows<{ id: string }>(
      `INSERT INTO items (list_id, title, kind, added_by, suggestion_state)
       VALUES ($1, 'Suggested', 'movie', $2, 'pending') RETURNING id`,
      [matchListId, ownerId],
    );
    expect(titlesOf((await read(matchListId)).open)).toEqual(["Placed"]);
    const res = await itemAcceptRoutes.request(`/${pending?.id}/accept`, {
      method: "POST",
      headers: headers(friendId),
    });
    expect(res.status).toBe(200);
    const s = await read(matchListId);
    expect(titlesOf(s.open)).toEqual(["Suggested", "Placed"]);
    expect(s.inbox).toEqual([]);
    expect(placed.Placed).toBeTruthy();
  });

  it("folds the inbox in below the list when the last source is removed", async () => {
    const ids = await seedUnplaced(shelfListId, ["A", "B", "C"], "spotify_album");
    await move(ids.A ?? "", { section: "list" });
    const res = await listRoutes.request(`/${shelfListId}/sources/${shelfSourceId}`, {
      method: "DELETE",
      headers: headers(),
    });
    expect(res.status).toBe(200);
    const s = await read(shelfListId);
    expect(titlesOf(s.open)).toEqual(["A", "C", "B"]);
    expect(s.inbox).toEqual([]);
  });

  it("an inbox row ticked done and reopened goes back to the inbox", async () => {
    await rows(`UPDATE lists SET modules = '{todo,sources}' WHERE id = $1`, [shelfListId]);
    const ids = await seedUnplaced(shelfListId, ["A"], "spotify_album");
    await itemRoutes.request(`/${ids.A}/complete`, { method: "POST", headers: headers() });
    await itemRoutes.request(`/${ids.A}/uncomplete`, { method: "POST", headers: headers() });
    expect(titlesOf((await read(shelfListId)).inbox)).toEqual(["A"]);
  });
});

describe("back to the inbox (the Undo of “Add to list”)", () => {
  it("`section: inbox` returns a placed row to the inbox on a list with a source", async () => {
    const ids = await seedUnplaced(shelfListId, ["A", "B"], "spotify_album");
    await move(ids.A ?? "", { section: "list" });
    await move(ids.A ?? "", { section: "inbox" });
    const s = await read(shelfListId);
    expect(s.open).toEqual([]);
    expect(titlesOf(s.inbox)).toEqual(["B", "A"]);
  });

  it("`section: inbox` changes nothing on a list without a source", async () => {
    const ids = await addAll(plainListId, ["A", "B"]);
    const res = await move(ids.A ?? "", { section: "inbox" });
    expect(res.status).toBe(200);
    expect(await open(plainListId)).toEqual(["B", "A"]);
  });
});

describe("duplicating a list", () => {
  it("keeps the order, with a source's inbox following the list", async () => {
    const ids = await seedUnplaced(shelfListId, ["A", "B", "C"], "spotify_album");
    await move(ids.A ?? "", { section: "list" });
    await move(ids.B ?? "", { section: "list", beforeItemId: ids.A });
    const res = await listRoutes.request(`/${shelfListId}/duplicate`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const { list } = (await res.json()) as { list: { id: string } };
    const copy = await read(list.id);
    expect(titlesOf(copy.open)).toEqual(["A", "B", "C"]);
    expect(copy.inbox).toEqual([]);
  });
});
