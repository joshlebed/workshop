// Migration 0058 (one ordered list) on in-memory PGlite. The database is
// migrated up to 0057, filled with every pre-migration shape (a Ranked block
// with a position tie, hand-placed and never-placed unranked rows, done rows,
// a list with ranking off but stale positions, check-off off, an album shelf
// with an inbox, a Letterboxd-match list with a pending and an accepted
// suggestion, a legacy leaderboard list, a deleted list), then 0058 runs.
//
// The proof: for every list, the open rows the app displays before (the old
// rule, written out as SQL below) and after (the new read path) are the same
// sequence; nothing but `position`, `order_key` and `modules` changes; and a
// second run changes nothing.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;
vi.mock("./client.js", () => ({ getDb: () => testDb }));
const { fetchItemsForList } = await import("../routes/v1/items.js");

const MIGRATION = "0058_one_ordered_list";
let client: PGlite;
let partialFolder: string;

const owner = "00000000-0000-4000-8000-000000000001";
const L = {
  ranked: "00000000-0000-4000-8000-0000000000a1",
  rankingOff: "00000000-0000-4000-8000-0000000000a2",
  noTodo: "00000000-0000-4000-8000-0000000000a3",
  shelf: "00000000-0000-4000-8000-0000000000a4",
  match: "00000000-0000-4000-8000-0000000000a5",
  leaderboard: "00000000-0000-4000-8000-0000000000a6",
  deleted: "00000000-0000-4000-8000-0000000000a7",
  empty: "00000000-0000-4000-8000-0000000000a8",
};

async function q<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await client.query<T>(query, params)).rows;
}

let seq = 0;
async function item(
  listId: string,
  title: string,
  fields: Partial<{
    position: number;
    order_key: number;
    completed: boolean;
    archived: boolean;
    kind: string;
    content: Record<string, unknown>;
    suggestion_state: string;
  }> = {},
): Promise<string> {
  seq += 1;
  const [row] = await q<{ id: string }>(
    `INSERT INTO items (list_id, title, kind, added_by, position, order_key, completed, completed_at,
                        archived_at, content, suggestion_state, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 THEN now() - ($10 || ' seconds')::interval END,
             CASE WHEN $8 THEN now() END, $9::jsonb, $11,
             now() - ($10 || ' minutes')::interval, now() - ($10 || ' hours')::interval)
     RETURNING id`,
    [
      listId,
      title,
      fields.kind ?? "plain",
      owner,
      fields.position ?? null,
      fields.order_key ?? null,
      fields.completed ?? false,
      fields.archived ?? false,
      JSON.stringify(fields.content ?? {}),
      String(10_000 - seq),
      fields.suggestion_state ?? null,
    ],
  );
  if (!row) throw new Error("insert failed");
  return row.id;
}

// The old display rule (pre-0058 `fetchItemsForList` + the client): with
// `ranking` on, rows with a position first by position (ties in the unranked
// order), then the rest by `order_key` NULLs first, newest first, id. Done
// rows leave with `todo` on; pending suggestions leave with `letterboxd` on.
async function oldDisplay(listId: string): Promise<string[]> {
  const r = await q<{ title: string }>(
    `SELECT i.title FROM items i JOIN lists l ON l.id = i.list_id
     WHERE i.list_id = $1 AND i.archived_at IS NULL
       AND NOT ('todo' = ANY(l.modules) AND i.completed)
       AND NOT ('letterboxd' = ANY(l.modules) AND i.suggestion_state IS NOT DISTINCT FROM 'pending')
     ORDER BY
       CASE WHEN ('ranking' = ANY(l.modules) OR 'leaderboard' = ANY(l.modules)) AND i.position IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN 'ranking' = ANY(l.modules) AND i.position IS NOT NULL THEN i.position END,
       i.order_key ASC NULLS FIRST,
       COALESCE(i.content->>'detectedAt', i.created_at::text) DESC, i.id ASC`,
    [listId],
  );
  return r.map((x) => x.title);
}

async function newDisplay(listId: string): Promise<{ open: string[]; inbox: string[] }> {
  const res = await fetchItemsForList(listId, testDb as never);
  return { open: res.open.map((i) => i.title), inbox: res.inbox.map((i) => i.title) };
}

async function untouchedHash(): Promise<string> {
  const [row] = await q<{ h: string }>(
    `SELECT md5(string_agg(concat_ws('|', id, title, kind, completed, completed_at, archived_at,
              content::text, suggestion_state, created_at, updated_at), E'\\n' ORDER BY id)) ||
            (SELECT md5(string_agg(concat_ws('|', id, name, archived_at, updated_at), ',' ORDER BY id)) FROM lists) AS h
     FROM items`,
  );
  return row?.h ?? "";
}

async function orderState(): Promise<string> {
  const [row] = await q<{ h: string }>(
    `SELECT string_agg(concat_ws(':', title, position, order_key), ',' ORDER BY id) ||
            (SELECT string_agg(modules::text, ',' ORDER BY id) FROM lists) AS h FROM items`,
  );
  return row?.h ?? "";
}

const before: Record<string, string[]> = {};
let hashBefore = "";
let leaderboardBefore: unknown[] = [];

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  // Every migration except 0058.
  partialFolder = mkdtempSync(join(tmpdir(), "one-order-"));
  cpSync("./drizzle", partialFolder, { recursive: true });
  rmSync(join(partialFolder, `${MIGRATION}.sql`));
  const journalPath = join(partialFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag !== MIGRATION);
  writeFileSync(journalPath, JSON.stringify(journal));

  client = new PGlite();
  testDb = drizzle(client);
  await migrate(testDb, { migrationsFolder: partialFolder });

  await q(`INSERT INTO users (id, email, display_name) VALUES ($1, 'o@example.com', 'O')`, [owner]);
  const lists: [string, string, string, string | null, boolean][] = [
    [L.ranked, "Ranked", "{todo,ranking}", "plain", false],
    [L.rankingOff, "Ranking off", "{todo}", "plain", false],
    [L.noTodo, "No todo", "{ranking}", null, false],
    [L.shelf, "Shelf", "{ranking,sources}", "spotify_album", false],
    [L.match, "Match", "{todo,ranking,sources,letterboxd}", "movie", false],
    [L.leaderboard, "Geo games", "{leaderboard}", "link", false],
    [L.deleted, "Deleted", "{todo,ranking}", "plain", true],
    [L.empty, "Empty", "{ranking}", null, false],
  ];
  for (const [id, name, modules, kind, deleted] of lists) {
    await q(
      `INSERT INTO lists (id, name, emoji, color, share_slug, owner_id, modules, item_kind, archived_at, updated_at)
       VALUES ($1, $2, '📝', 'amber', $7, $3, $4, $5, CASE WHEN $6 THEN now() END, now() - interval '3 days')`,
      [id, name, owner, modules, kind, deleted, `slug-${id.slice(-2)}`],
    );
  }

  await q(
    `INSERT INTO list_sources (list_id, kind, config) VALUES
       ($1, 'spotify_playlist', '{"spotifyPlaylistId":"p1"}'), ($2, 'letterboxd_match', '{}')`,
    [L.shelf, L.match],
  );

  // A Ranked block with a position tie, unranked rows hand-placed and not,
  // done rows in both blocks, a deleted row.
  await item(L.ranked, "r-2048", { position: 2048, order_key: 300 });
  await item(L.ranked, "r-1024-a", { position: 1024 });
  await item(L.ranked, "r-1024-b", { position: 1024 });
  await item(L.ranked, "u-key-200", { order_key: 200 });
  await item(L.ranked, "u-old");
  await item(L.ranked, "u-key-100", { order_key: 100 });
  await item(L.ranked, "u-new");
  await item(L.ranked, "done-ranked", { position: 512, completed: true });
  await item(L.ranked, "done-unranked", { completed: true });
  await item(L.ranked, "deleted", { position: 10, archived: true });

  // Ranking off: stale positions are not an order.
  await item(L.rankingOff, "stale-1", { position: 1024 });
  await item(L.rankingOff, "plain-1");
  await item(L.rankingOff, "stale-2", { position: 99 });
  await item(L.rankingOff, "keyed", { order_key: -5 });

  // Check-off off: a ticked row is still on the list.
  await item(L.noTodo, "a", { position: 1024 });
  await item(L.noTodo, "ticked", { completed: true });
  await item(L.noTodo, "b");

  // Album shelf: ranked albums, never-placed synced albums (the inbox).
  const album = (id: string, at: string) => ({
    kind: "spotify_album",
    content: { source: "spotify", spotifyAlbumId: id, detectedAt: at },
  });
  await item(L.shelf, "shelf-2", { ...album("a2", "2026-03-01T00:00:00.000Z"), position: 2048 });
  await item(L.shelf, "shelf-1", { ...album("a1", "2026-03-01T00:00:00.000Z"), position: 1024 });
  await item(L.shelf, "detected-old", album("a3", "2026-01-01T00:00:00.000Z"));
  await item(L.shelf, "detected-new", album("a4", "2026-02-01T00:00:00.000Z"));

  // Letterboxd match: a synced film (inbox), an accepted suggestion (placed
  // by people: joins the list), a pending suggestion (left alone).
  const film = (slug: string) => ({ kind: "movie", content: { letterboxdSlug: slug } });
  await item(L.match, "synced-film", film("s1"));
  const accepted = await item(L.match, "accepted-suggestion", film("s2"));
  await q(
    `INSERT INTO activity_events (list_id, actor_id, event_type, item_id, payload)
     VALUES ($1, $2, 'item_suggested', $3, '{}')`,
    [L.match, owner, accepted],
  );
  await item(L.match, "pending", { ...film("s3"), suggestion_state: "pending" });
  await item(L.match, "ranked-film", { ...film("s4"), position: 1024 });

  // Never touched.
  await item(L.leaderboard, "game-1", { position: 2048 });
  await item(L.leaderboard, "game-null");
  await item(L.deleted, "in-deleted-list");

  for (const id of Object.values(L)) before[id] = await oldDisplay(id);
  hashBefore = await untouchedHash();
  leaderboardBefore = await q(
    `SELECT id, position, order_key FROM items WHERE list_id = $1 ORDER BY id`,
    [L.leaderboard],
  );

  await migrate(testDb, { migrationsFolder: "./drizzle" });
}, 60_000);

afterAll(() => {
  rmSync(partialFolder, { recursive: true, force: true });
});

describe(`migration ${MIGRATION}`, () => {
  it("keeps every list's displayed order exactly", async () => {
    for (const id of [L.ranked, L.rankingOff, L.noTodo, L.empty]) {
      const now = await newDisplay(id);
      expect(now.inbox).toEqual([]);
      expect(now.open).toEqual(before[id]);
    }
    expect(before[L.ranked]).toEqual([
      "r-1024-b",
      "r-1024-a",
      "r-2048",
      "u-new",
      "u-old",
      "u-key-100",
      "u-key-200",
    ]);
  });

  it("keeps the album shelf: placed albums are the list, never-placed ones the inbox", async () => {
    expect(before[L.shelf]).toEqual(["shelf-1", "shelf-2", "detected-new", "detected-old"]);
    expect(await newDisplay(L.shelf)).toEqual({
      open: ["shelf-1", "shelf-2"],
      inbox: ["detected-new", "detected-old"],
    });
  });

  it("puts an accepted suggestion in the list and a synced film in the inbox", async () => {
    expect(before[L.match]).toEqual(["ranked-film", "accepted-suggestion", "synced-film"]);
    expect(await newDisplay(L.match)).toEqual({
      open: ["ranked-film", "accepted-suggestion"],
      inbox: ["synced-film"],
    });
    const [pending] = await q<{ position: number | null }>(
      `SELECT position FROM items WHERE title = 'pending'`,
    );
    expect(pending?.position).toBeNull();
  });

  it("gives done rows the place they return to when reopened", async () => {
    const r = await q<{ title: string; position: number }>(
      `SELECT title, position FROM items WHERE list_id = $1 AND archived_at IS NULL ORDER BY position`,
      [L.ranked],
    );
    const order = r.map((x) => x.title);
    expect(order.indexOf("done-ranked")).toBeLessThan(order.indexOf("r-1024-b"));
    expect(order.indexOf("done-unranked")).toBeGreaterThan(order.indexOf("r-2048"));
    const [deleted] = await q<{ position: number }>(
      `SELECT position FROM items WHERE title = 'deleted'`,
    );
    expect(deleted?.position).toBe(10);
  });

  it("drops the retired ranking module, except on legacy and deleted lists", async () => {
    const r = await q<{ id: string; modules: string[] }>(`SELECT id, modules FROM lists`);
    const modules = Object.fromEntries(r.map((x) => [x.id, x.modules]));
    expect(modules[L.ranked]).toEqual(["todo"]);
    expect(modules[L.shelf]).toEqual(["sources"]);
    expect(modules[L.match]).toEqual(["todo", "sources", "letterboxd"]);
    expect(modules[L.empty]).toEqual([]);
    expect(modules[L.leaderboard]).toEqual(["leaderboard"]);
    expect(modules[L.deleted]).toEqual(["todo", "ranking"]);
  });

  it("changes nothing but position, order_key and modules", async () => {
    expect(await untouchedHash()).toBe(hashBefore);
    const lb = await q(`SELECT id, position, order_key FROM items WHERE list_id = $1 ORDER BY id`, [
      L.leaderboard,
    ]);
    expect(lb).toEqual(leaderboardBefore);
    const [inDeleted] = await q<{ position: number | null }>(
      `SELECT position FROM items WHERE title = 'in-deleted-list'`,
    );
    expect(inDeleted?.position).toBeNull();
  });

  it("mirrors position into order_key so the previous backend reads the same order", async () => {
    const r = await q(
      `SELECT 1 FROM items i JOIN lists l ON l.id = i.list_id
       WHERE i.position IS NOT NULL AND i.order_key IS DISTINCT FROM i.position
         AND l.archived_at IS NULL AND i.archived_at IS NULL AND NOT ('leaderboard' = ANY(l.modules))`,
    );
    expect(r).toEqual([]);
  });

  it("is a no-op when run again", async () => {
    const state = await orderState();
    const sqlText = readFileSync(`./drizzle/${MIGRATION}.sql`, "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      await client.exec(statement);
    }
    expect(await orderState()).toBe(state);
    expect(await untouchedHash()).toBe(hashBefore);
  });
});
