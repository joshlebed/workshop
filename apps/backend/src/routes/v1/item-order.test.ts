// Integration tests for UX pass 2.3 + 2.7 on in-memory PGlite with the real
// migrations: hand order inside the unranked block (`order_key`), every move
// shape `POST /v1/items/:id/move` accepts (legacy and `section`), and the
// delete Undo, `POST /v1/items/:id/unarchive`. The behaviour is DB-shaped
// (sparse keys, materialization, archived filters), so it runs real SQL.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the mock so the routers' `getDb` resolves to PGlite.
import { itemRoutes } from "./items.js";
import { listRoutes } from "./lists.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const outsiderId = "00000000-0000-4000-8000-000000000002";
const rankedListId = "00000000-0000-4000-8000-0000000000b1";
const plainListId = "00000000-0000-4000-8000-0000000000b2";
const shelfListId = "00000000-0000-4000-8000-0000000000b3";

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
interface Sections {
  ordered: WireItem[];
  unordered: WireItem[];
  completed: WireItem[];
}

async function sections(listId: string): Promise<{ ranked: string[]; open: string[] }> {
  const res = await listRoutes.request(`/${listId}/items`, { headers: headers() });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Sections;
  return {
    ranked: body.ordered.map((i) => i.title),
    open: body.unordered.map((i) => i.title),
  };
}

async function move(itemId: string, body: Record<string, unknown>, userId = ownerId) {
  const res = await itemRoutes.request(`/${itemId}/move`, {
    method: "POST",
    headers: headers(userId),
    body: JSON.stringify(body),
  });
  return res;
}

let seq = 0;
/** Insert items oldest → newest so the last title is the newest row. */
async function seed(listId: string, titles: string[], kind = "plain"): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    seq += 1;
    const [row] = await rows<{ id: string }>(
      `INSERT INTO items (list_id, title, kind, added_by, created_at)
       VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval) RETURNING id`,
      [listId, title, kind, ownerId, String(10_000 - seq)],
    );
    if (!row) throw new Error("insert failed");
    ids.push(row.id);
  }
  return ids;
}

function idOf(ids: string[], titles: string[], title: string): string {
  const i = titles.indexOf(title);
  const id = ids[i];
  if (!id) throw new Error(`no id for ${title}`);
  return id;
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
       ($1, 'owner@example.com', 'Owner'), ($2, 'out@example.com', 'Out')`,
    [ownerId, outsiderId],
  );
  await rows(
    `INSERT INTO lists (id, name, emoji, color, share_slug, owner_id, modules, item_kind) VALUES
       ($1, 'Ranked', '🏆', 'amber', 'ranked', $4, '{ranking,todo}', 'plain'),
       ($2, 'Plain', '📝', 'amber', 'plain', $4, '{todo}', 'plain'),
       ($3, 'Shelf', '📀', 'amber', 'shelf', $4, '{ranking,sources}', 'spotify_album')`,
    [rankedListId, plainListId, shelfListId, ownerId],
  );
  await rows(
    `INSERT INTO list_members (list_id, user_id, role) VALUES
       ($1, $4, 'owner'), ($2, $4, 'owner'), ($3, $4, 'owner')`,
    [rankedListId, plainListId, shelfListId, ownerId],
  );
}, 60_000);

beforeEach(async () => {
  await rows(`DELETE FROM activity_events`);
  await rows(`DELETE FROM items`);
});

describe("unranked order on a list without ranking", () => {
  const titles = ["A", "B", "C", "D"];

  it("defaults to newest first", async () => {
    await seed(plainListId, titles);
    expect((await sections(plainListId)).open).toEqual(["D", "C", "B", "A"]);
  });

  it("moves a row between two neighbours and persists the whole order", async () => {
    const ids = await seed(plainListId, titles);
    // Displayed D C B A; drag A between D and C.
    const res = await move(idOf(ids, titles, "A"), {
      section: "unranked",
      beforeItemId: idOf(ids, titles, "D"),
      afterItemId: idOf(ids, titles, "C"),
    });
    expect(res.status).toBe(200);
    expect((await sections(plainListId)).open).toEqual(["D", "A", "C", "B"]);
  });

  it("moves to the bottom (before only) and to the top (after only)", async () => {
    const ids = await seed(plainListId, titles);
    await move(idOf(ids, titles, "D"), {
      section: "unranked",
      beforeItemId: idOf(ids, titles, "A"),
    });
    expect((await sections(plainListId)).open).toEqual(["C", "B", "A", "D"]);
    await move(idOf(ids, titles, "A"), {
      section: "unranked",
      afterItemId: idOf(ids, titles, "C"),
    });
    expect((await sections(plainListId)).open).toEqual(["A", "C", "B", "D"]);
  });

  it("puts a row at the top of the block when no neighbour is named", async () => {
    const ids = await seed(plainListId, titles);
    await move(idOf(ids, titles, "B"), { section: "unranked" });
    expect((await sections(plainListId)).open).toEqual(["B", "D", "C", "A"]);
  });

  it("lands a new item at the top of an already hand-ordered block", async () => {
    const ids = await seed(plainListId, titles);
    await move(idOf(ids, titles, "D"), {
      section: "unranked",
      beforeItemId: idOf(ids, titles, "A"),
    });
    const res = await listRoutes.request(`/${plainListId}/items`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ title: "New" }),
    });
    expect(res.status).toBe(201);
    expect((await sections(plainListId)).open).toEqual(["New", "C", "B", "A", "D"]);
    // And the next hand placement keeps everyone else where they were.
    const [newRow] = await rows<{ id: string }>(`SELECT id FROM items WHERE title = 'New'`);
    await move(newRow?.id ?? "", { section: "unranked", beforeItemId: idOf(ids, titles, "B") });
    expect((await sections(plainListId)).open).toEqual(["C", "B", "New", "A", "D"]);
  });

  it("re-spaces keys when two neighbours are adjacent", async () => {
    const ids = await seed(plainListId, titles);
    await move(idOf(ids, titles, "A"), { section: "unranked" });
    await rows(`UPDATE items SET order_key = 10 WHERE id = $1`, [idOf(ids, titles, "D")]);
    await rows(`UPDATE items SET order_key = 11 WHERE id = $1`, [idOf(ids, titles, "C")]);
    await rows(`UPDATE items SET order_key = 5 WHERE id = $1`, [idOf(ids, titles, "A")]);
    await rows(`UPDATE items SET order_key = 20 WHERE id = $1`, [idOf(ids, titles, "B")]);
    expect((await sections(plainListId)).open).toEqual(["A", "D", "C", "B"]);
    await move(idOf(ids, titles, "B"), {
      section: "unranked",
      beforeItemId: idOf(ids, titles, "D"),
      afterItemId: idOf(ids, titles, "C"),
    });
    expect((await sections(plainListId)).open).toEqual(["A", "D", "B", "C"]);
  });

  it("keeps the legacy 409 for a ranked or legacy-shaped move", async () => {
    const ids = await seed(plainListId, titles);
    const legacy = await move(idOf(ids, titles, "A"), { beforeItemId: idOf(ids, titles, "B") });
    expect(legacy.status).toBe(409);
    const ranked = await move(idOf(ids, titles, "A"), { section: "ranked" });
    expect(ranked.status).toBe(409);
  });

  it("returns a completed row to its old place when it is reopened", async () => {
    const ids = await seed(plainListId, titles);
    await move(idOf(ids, titles, "A"), {
      section: "unranked",
      beforeItemId: idOf(ids, titles, "D"),
      afterItemId: idOf(ids, titles, "C"),
    });
    const a = idOf(ids, titles, "A");
    await itemRoutes.request(`/${a}/complete`, { method: "POST", headers: headers() });
    expect((await sections(plainListId)).open).toEqual(["D", "C", "B"]);
    await itemRoutes.request(`/${a}/uncomplete`, { method: "POST", headers: headers() });
    expect((await sections(plainListId)).open).toEqual(["D", "A", "C", "B"]);
  });
});

describe("moves on a ranking list", () => {
  const titles = ["A", "B", "C", "D", "E"];

  async function rankFirstTwo(ids: string[]) {
    // Legacy promote into an empty Ranked section, then append.
    await move(idOf(ids, titles, "A"), { ordered: true });
    await move(idOf(ids, titles, "B"), { ordered: true });
  }

  it("legacy: both null without `ordered` demotes", async () => {
    const ids = await seed(rankedListId, titles);
    await rankFirstTwo(ids);
    const res = await move(idOf(ids, titles, "A"), {});
    expect(res.status).toBe(200);
    expect((await sections(rankedListId)).ranked).toEqual(["B"]);
  });

  it("legacy: `ordered: true` ranks into an empty section, then appends", async () => {
    const ids = await seed(rankedListId, titles);
    await rankFirstTwo(ids);
    const s = await sections(rankedListId);
    expect(s.ranked).toEqual(["A", "B"]);
    expect(s.open).toEqual(["E", "D", "C"]);
  });

  it("legacy: neighbour ids reorder within Ranked", async () => {
    const ids = await seed(rankedListId, titles);
    await rankFirstTwo(ids);
    await move(idOf(ids, titles, "A"), { beforeItemId: idOf(ids, titles, "B") });
    expect((await sections(rankedListId)).ranked).toEqual(["B", "A"]);
  });

  it("`section: ranked` with no neighbours starts an empty Ranked section", async () => {
    const ids = await seed(rankedListId, titles);
    const res = await move(idOf(ids, titles, "C"), { section: "ranked" });
    expect(res.status).toBe(200);
    expect((await sections(rankedListId)).ranked).toEqual(["C"]);
    const [event] = await rows<{ event_type: string }>(`SELECT event_type FROM activity_events`);
    expect(event?.event_type).toBe("item_promoted");
  });

  it("promotes between two ranked rows", async () => {
    const ids = await seed(rankedListId, titles);
    await rankFirstTwo(ids);
    await move(idOf(ids, titles, "E"), {
      section: "ranked",
      beforeItemId: idOf(ids, titles, "A"),
      afterItemId: idOf(ids, titles, "B"),
    });
    expect((await sections(rankedListId)).ranked).toEqual(["A", "E", "B"]);
  });

  it("demotes to a chosen place in the unranked block", async () => {
    const ids = await seed(rankedListId, titles);
    await rankFirstTwo(ids);
    // Open block shows E D C; drop A between D and C.
    const res = await move(idOf(ids, titles, "A"), {
      section: "unranked",
      beforeItemId: idOf(ids, titles, "D"),
      afterItemId: idOf(ids, titles, "C"),
    });
    expect(res.status).toBe(200);
    const s = await sections(rankedListId);
    expect(s.ranked).toEqual(["B"]);
    expect(s.open).toEqual(["E", "D", "A", "C"]);
    const events = await rows<{ event_type: string }>(
      `SELECT event_type FROM activity_events ORDER BY created_at`,
    );
    expect(events.map((e) => e.event_type)).toContain("item_demoted");
  });

  it("reorders within the unranked block without touching Ranked or logging activity", async () => {
    const ids = await seed(rankedListId, titles);
    await rankFirstTwo(ids);
    await rows(`DELETE FROM activity_events`);
    await move(idOf(ids, titles, "C"), { section: "unranked" });
    const s = await sections(rankedListId);
    expect(s.ranked).toEqual(["A", "B"]);
    expect(s.open).toEqual(["C", "E", "D"]);
    expect(await rows(`SELECT 1 FROM activity_events`)).toHaveLength(0);
  });

  it("404s a move for a non-member", async () => {
    const ids = await seed(rankedListId, titles);
    const res = await move(idOf(ids, titles, "A"), { section: "unranked" }, outsiderId);
    expect(res.status).toBe(404);
  });

  it("rejects an unknown section", async () => {
    const ids = await seed(rankedListId, titles);
    const res = await move(idOf(ids, titles, "A"), { section: "sideways" });
    expect(res.status).toBe(400);
  });
});

describe("album shelf detected order", () => {
  it("stays newest-detected first after a ranked move", async () => {
    const titles = ["Old", "Mid", "New"];
    const ids = await seed(shelfListId, titles, "spotify_album");
    await rows(
      `UPDATE items SET content = jsonb_build_object('spotifyAlbumId', title, 'detectedAt', $2::text)
       WHERE id = $1`,
      [idOf(ids, titles, "Old"), "2026-01-01T00:00:00.000Z"],
    );
    await rows(
      `UPDATE items SET content = jsonb_build_object('spotifyAlbumId', title, 'detectedAt', $2::text)
       WHERE id = $1`,
      [idOf(ids, titles, "Mid"), "2026-02-01T00:00:00.000Z"],
    );
    await rows(
      `UPDATE items SET content = jsonb_build_object('spotifyAlbumId', title, 'detectedAt', $2::text)
       WHERE id = $1`,
      [idOf(ids, titles, "New"), "2026-03-01T00:00:00.000Z"],
    );
    await move(idOf(ids, titles, "Mid"), { ordered: true });
    const s = await sections(shelfListId);
    expect(s.ranked).toEqual(["Mid"]);
    expect(s.open).toEqual(["New", "Old"]);
    await move(idOf(ids, titles, "Mid"), {});
    expect((await sections(shelfListId)).open).toEqual(["New", "Mid", "Old"]);
  });
});

describe("POST /v1/items/:id/unarchive", () => {
  async function del(itemId: string) {
    const res = await itemRoutes.request(`/${itemId}`, { method: "DELETE", headers: headers() });
    expect(res.status).toBe(200);
  }
  async function restore(itemId: string, userId = ownerId) {
    return itemRoutes.request(`/${itemId}/unarchive`, { method: "POST", headers: headers(userId) });
  }

  it("restores a deleted item to its old place and logs item_restored", async () => {
    const titles = ["A", "B", "C"];
    const ids = await seed(plainListId, titles);
    await move(idOf(ids, titles, "A"), { section: "unranked" });
    expect((await sections(plainListId)).open).toEqual(["A", "C", "B"]);
    const c = idOf(ids, titles, "C");
    await del(c);
    expect((await sections(plainListId)).open).toEqual(["A", "B"]);
    const res = await restore(c);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: WireItem };
    expect(body.item.title).toBe("C");
    expect((await sections(plainListId)).open).toEqual(["A", "C", "B"]);
    const events = await rows<{ event_type: string; payload: { title: string } }>(
      `SELECT event_type, payload FROM activity_events ORDER BY created_at`,
    );
    const last = events.at(-1);
    expect(last?.event_type).toBe("item_restored");
    expect(last?.payload.title).toBe("C");
  });

  it("restores a ranked item into its rank", async () => {
    const titles = ["A", "B"];
    const ids = await seed(rankedListId, titles);
    await move(idOf(ids, titles, "A"), { ordered: true });
    await move(idOf(ids, titles, "B"), { ordered: true });
    await del(idOf(ids, titles, "A"));
    expect((await sections(rankedListId)).ranked).toEqual(["B"]);
    await restore(idOf(ids, titles, "A"));
    expect((await sections(rankedListId)).ranked).toEqual(["A", "B"]);
  });

  it("is idempotent for a live item and writes no event", async () => {
    const [id] = await seed(plainListId, ["A"]);
    const res = await restore(id ?? "");
    expect(res.status).toBe(200);
    expect(await rows(`SELECT 1 FROM activity_events`)).toHaveLength(0);
  });

  it("404s a non-member and an item whose list is deleted", async () => {
    const [id] = await seed(plainListId, ["A"]);
    await del(id ?? "");
    expect((await restore(id ?? "", outsiderId)).status).toBe(404);
    await rows(`UPDATE lists SET archived_at = now() WHERE id = $1`, [plainListId]);
    try {
      expect((await restore(id ?? "")).status).toBe(404);
    } finally {
      await rows(`UPDATE lists SET archived_at = NULL WHERE id = $1`, [plainListId]);
    }
  });

  it("404s a malformed id", async () => {
    expect((await restore("not-a-uuid")).status).toBe(404);
  });

  it("restores an album without tripping the shelf's unique index", async () => {
    const [id] = await seed(shelfListId, ["Blonde"], "spotify_album");
    await rows(`UPDATE items SET content = '{"spotifyAlbumId":"x1"}'::jsonb WHERE id = $1`, [id]);
    await del(id ?? "");
    const res = await restore(id ?? "");
    expect(res.status).toBe(200);
    expect((await sections(shelfListId)).open).toEqual(["Blonde"]);
  });
});
