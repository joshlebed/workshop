// Features per list kind (`@workshop/shared/listKinds`, docs/list-types.md):
// what `POST /v1/lists`, `PATCH /v1/lists/:id`, `POST /:id/config-preview`
// and the source routes accept for every kind, the derived `sources` module,
// the Letterboxd-match source that follows its toggle, old-client tolerance,
// and the 0057 data migration. Real SQL on PGlite; the source dispatch is
// faked so nothing reaches Spotify or Letterboxd.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { List } from "@workshop/shared";
import { LIST_KINDS, type ListKindKey, TOGGLE_FEATURES } from "@workshop/shared/listKinds";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

vi.mock("../../middleware/rate-limit.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<unknown>) => next(),
}));

vi.mock("../../lib/sources/registry.js", () => ({
  dispatchFor: () => ({
    preview: async (_c: unknown, raw: Record<string, unknown>) => ({
      ok: true,
      config: raw,
      preview: { kind: "fake" },
    }),
    sync: async () => ({ addedCount: 0, refreshedAt: new Date() }),
  }),
}));

import { listRoutes } from "./lists.js";

const owner = "00000000-0000-4000-8000-0000000000f1";
let auth: Record<string, string> = {};
let json: Record<string, string> = {};

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query(query, params)).rows as T[];
}

const SPOTIFY = { kind: "spotify_playlist", config: { spotifyPlaylistUrl: "https://x/p" } };
const LETTERBOXD = { kind: "letterboxd_list", config: { letterboxdUrl: "https://x/l" } };

function itemKindOf(key: ListKindKey): string | null {
  return key === "blank" ? null : key;
}

async function createList(body: Record<string, unknown>) {
  const res = await listRoutes.request("/", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ name: "zz", emoji: "📝", color: "slate", ...body }),
  });
  return { res, body: (await res.json()) as { list?: List; details?: { code?: string } } };
}

async function patchList(id: string, body: Record<string, unknown>) {
  const res = await listRoutes.request(`/${id}`, {
    method: "PATCH",
    headers: json,
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as { list?: List; details?: { code?: string } } };
}

async function modulesOf(id: string): Promise<string[]> {
  const [row] = await rows<{ modules: string[] }>("SELECT modules FROM lists WHERE id = $1", [id]);
  return row?.modules ?? [];
}

async function sourceKinds(id: string): Promise<string[]> {
  return (
    await rows<{ kind: string }>("SELECT kind FROM list_sources WHERE list_id = $1 ORDER BY kind", [
      id,
    ])
  ).map((r) => r.kind);
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  auth = { Authorization: `Bearer ${signSession(owner)}` };
  json = { ...auth, "Content-Type": "application/json" };
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows("INSERT INTO users (id, email, display_name) VALUES ($1, 'o@example.com', 'O')", [
    owner,
  ]);
}, 60_000);

const KINDS = Object.keys(LIST_KINDS) as ListKindKey[];

describe("create: every kind × every toggle", () => {
  for (const key of KINDS) {
    for (const feature of TOGGLE_FEATURES) {
      const offered = (LIST_KINDS[key].features as readonly string[]).includes(feature);
      it(`${key} + ${feature} → ${offered ? "201" : "400 feature_not_offered"}`, async () => {
        const { res, body } = await createList({ itemKind: itemKindOf(key), modules: [feature] });
        if (!offered) {
          expect(res.status).toBe(400);
          expect(body.details?.code).toBe("feature_not_offered");
          return;
        }
        expect(res.status).toBe(201);
        const id = body.list?.id ?? "";
        if (feature === "letterboxd") {
          // Letterboxd match brings its own source, so `sources` comes on too.
          expect(await modulesOf(id)).toEqual(["sources", "letterboxd"]);
          expect(await sourceKinds(id)).toEqual(["letterboxd_match"]);
        } else {
          expect(await modulesOf(id)).toEqual([feature]);
          expect(await sourceKinds(id)).toEqual([]);
        }
      });
    }
  }
});

describe("create: sources are derived, and only offered ones attach", () => {
  it("ignores a requested sources with nothing attached (old clients)", async () => {
    const { res, body } = await createList({ itemKind: "plain", modules: ["todo", "sources"] });
    expect(res.status).toBe(201);
    expect(body.list?.modules).toEqual(["todo"]);
  });

  it("turns sources on when the template attaches its source, sent or not", async () => {
    const shelf = await createList({
      itemKind: "spotify_album",
      modules: ["ranking"],
      sources: [SPOTIFY],
    });
    expect(shelf.body.list?.modules).toEqual(["ranking", "sources"]);
    // An old client still sends `sources`; same result.
    const old = await createList({
      itemKind: "movie",
      modules: ["todo", "ranking", "sources"],
      sources: [LETTERBOXD],
    });
    expect(old.body.list?.modules).toEqual(["todo", "ranking", "sources"]);
  });

  it("400s a source the kind does not sync from", async () => {
    for (const [itemKind, source] of [
      ["plain", SPOTIFY],
      ["movie", SPOTIFY],
      ["spotify_album", LETTERBOXD],
      [null, LETTERBOXD],
      ["book", { kind: "letterboxd_match", config: {} }],
    ] as const) {
      const { res, body } = await createList({ itemKind, modules: [], sources: [source] });
      expect(res.status).toBe(400);
      expect(body.details?.code).toBe("source_not_offered");
    }
  });

  it("treats a Letterboxd-match source as turning Letterboxd match on", async () => {
    const { body } = await createList({
      itemKind: "movie",
      modules: ["ranking"],
      sources: [{ kind: "letterboxd_match", config: {} }],
    });
    expect(body.list?.modules).toEqual(["ranking", "sources", "letterboxd"]);
  });

  it("still rejects the retired leaderboard", async () => {
    const { res, body } = await createList({ itemKind: "link", modules: ["leaderboard"] });
    expect(res.status).toBe(400);
    expect(body.details?.code).toBe("legacy_game_lists_retired");
  });
});

describe("PATCH: toggles per kind, derived sources, old-client tolerance", () => {
  for (const key of KINDS) {
    it(`${key}: offered toggles switch on and off; others 400`, async () => {
      const { body } = await createList({ itemKind: itemKindOf(key), modules: [] });
      const id = body.list?.id ?? "";
      for (const feature of TOGGLE_FEATURES) {
        const offered = (LIST_KINDS[key].features as readonly string[]).includes(feature);
        const on = await patchList(id, { modules: [feature] });
        if (!offered) {
          expect(on.res.status).toBe(400);
          expect(on.body.details?.code).toBe("feature_not_offered");
          expect(await modulesOf(id)).toEqual([]);
          continue;
        }
        expect(on.res.status).toBe(200);
        expect(await modulesOf(id)).toContain(feature);
        const off = await patchList(id, { modules: [] });
        expect(off.res.status).toBe(200);
        expect(await modulesOf(id)).toEqual([]);
        expect(await sourceKinds(id)).toEqual([]);
      }
    });
  }

  it("ignores an old client toggling sources by hand", async () => {
    const { body } = await createList({ itemKind: "plain", modules: ["todo"] });
    const id = body.list?.id ?? "";
    const on = await patchList(id, { modules: ["todo", "sources"] });
    expect(on.res.status).toBe(200);
    expect(on.body.list?.modules).toEqual(["todo"]);

    const shelf = await createList({ itemKind: "spotify_album", modules: [], sources: [SPOTIFY] });
    const shelfId = shelf.body.list?.id ?? "";
    // Old "Syncing" switch turned off: the source is still attached, so it stays on.
    const off = await patchList(shelfId, { modules: ["ranking"] });
    expect(off.res.status).toBe(200);
    expect(off.body.list?.modules).toEqual(["ranking", "sources"]);
    expect(await sourceKinds(shelfId)).toEqual(["spotify_playlist"]);
  });

  it("keeps an unoffered feature the list already has while other toggles change", async () => {
    const { body } = await createList({ itemKind: "book", modules: ["todo"] });
    const id = body.list?.id ?? "";
    // A row the migration has not normalized yet.
    await rows("UPDATE lists SET modules = '{todo,letterboxd}' WHERE id = $1", [id]);
    const res = await patchList(id, { modules: ["todo", "ranking", "letterboxd"] });
    expect(res.res.status).toBe(200);
    expect(await modulesOf(id)).toEqual(["todo", "ranking", "letterboxd"]);
    // Turning it off is always allowed.
    expect((await patchList(id, { modules: ["todo"] })).res.status).toBe(200);
    expect(await modulesOf(id)).toEqual(["todo"]);
  });

  it("attaches and removes the Letterboxd-match source with its toggle", async () => {
    const { body } = await createList({ itemKind: "movie", modules: ["todo"] });
    const id = body.list?.id ?? "";
    await patchList(id, { modules: ["todo", "letterboxd"] });
    expect(await modulesOf(id)).toEqual(["todo", "sources", "letterboxd"]);
    expect(await sourceKinds(id)).toEqual(["letterboxd_match"]);
    await patchList(id, { modules: ["todo"] });
    expect(await modulesOf(id)).toEqual(["todo"]);
    expect(await sourceKinds(id)).toEqual([]);
  });

  it("does not ask to confirm the derived sources going off", async () => {
    const { body } = await createList({ itemKind: "movie", modules: ["letterboxd"] });
    const id = body.list?.id ?? "";
    const res = await patchList(id, { modules: [] });
    expect(res.res.status).toBe(200);
  });

  it("leaves a legacy leaderboard row alone", async () => {
    const [row] = await rows<{ id: string }>(
      `INSERT INTO lists (name, emoji, color, share_slug, owner_id, modules, item_kind)
       VALUES ('Geo', '🎮', 'slate', 'geo-legacy', $1, '{leaderboard}', 'link') RETURNING id`,
      [owner],
    );
    await rows("INSERT INTO list_members (list_id, user_id, role) VALUES ($1, $2, 'owner')", [
      row?.id,
      owner,
    ]);
    const res = await patchList(row?.id ?? "", { name: "Geo games" });
    expect(res.res.status).toBe(200);
    expect(await modulesOf(row?.id ?? "")).toEqual(["leaderboard"]);
  });

  it("re-checks toggles when the kind changes", async () => {
    const { body } = await createList({ itemKind: "movie", modules: ["letterboxd"] });
    const id = body.list?.id ?? "";
    const res = await patchList(id, { itemKind: "book" });
    expect(res.res.status).toBe(400);
    expect(res.body.details?.code).toBe("source_not_offered");
  });
});

describe("config preview", () => {
  it("400s an unoffered toggle and ignores sources", async () => {
    const { body } = await createList({ itemKind: "tv", modules: ["todo"] });
    const id = body.list?.id ?? "";
    const bad = await listRoutes.request(`/${id}/config-preview`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ modules: ["letterboxd"] }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { details: { code: string } }).details.code).toBe(
      "feature_not_offered",
    );
    const okRes = await listRoutes.request(`/${id}/config-preview`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ modules: ["todo", "sources"] }),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ warnings: [] });
  });
});

describe("sources: attach first turns sources on, remove last turns it off", () => {
  it("on an album shelf", async () => {
    const { body } = await createList({ itemKind: "spotify_album", modules: ["ranking"] });
    const id = body.list?.id ?? "";
    expect(await modulesOf(id)).toEqual(["ranking"]);

    const attach = await listRoutes.request(`/${id}/sources`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(SPOTIFY),
    });
    expect(attach.status).toBe(201);
    const { source } = (await attach.json()) as { source: { id: string } };
    expect(await modulesOf(id)).toEqual(["ranking", "sources"]);

    const second = await listRoutes.request(`/${id}/sources`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(SPOTIFY),
    });
    const { source: other } = (await second.json()) as { source: { id: string } };

    await listRoutes.request(`/${id}/sources/${source.id}`, { method: "DELETE", headers: auth });
    expect(await modulesOf(id)).toEqual(["ranking", "sources"]);
    const removeLast = await listRoutes.request(`/${id}/sources/${other.id}`, {
      method: "DELETE",
      headers: auth,
    });
    expect(removeLast.status).toBe(200);
    expect(await modulesOf(id)).toEqual(["ranking"]);
  });

  it("no longer needs a sources switch first, and 400s an unoffered kind", async () => {
    const { body } = await createList({ itemKind: "movie", modules: [] });
    const id = body.list?.id ?? "";
    const wrong = await listRoutes.request(`/${id}/sources`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(SPOTIFY),
    });
    expect(wrong.status).toBe(400);
    const right = await listRoutes.request(`/${id}/sources`, {
      method: "POST",
      headers: json,
      body: JSON.stringify(LETTERBOXD),
    });
    expect(right.status).toBe(201);
    expect(await modulesOf(id)).toEqual(["sources"]);
  });

  it("keeps sources on while Letterboxd match still has its source", async () => {
    const { body } = await createList({
      itemKind: "movie",
      modules: ["letterboxd"],
      sources: [LETTERBOXD],
    });
    const id = body.list?.id ?? "";
    const [list] = await rows<{ id: string }>(
      "SELECT id FROM list_sources WHERE list_id = $1 AND kind = 'letterboxd_list'",
      [id],
    );
    await listRoutes.request(`/${id}/sources/${list?.id}`, { method: "DELETE", headers: auth });
    expect(await modulesOf(id)).toEqual(["sources", "letterboxd"]);
    // Removing the match source itself turns the feature off.
    const [match] = await rows<{ id: string }>("SELECT id FROM list_sources WHERE list_id = $1", [
      id,
    ]);
    await listRoutes.request(`/${id}/sources/${match?.id}`, { method: "DELETE", headers: auth });
    expect(await modulesOf(id)).toEqual([]);
  });

  it("duplicate without sources starts with sources off", async () => {
    const { body } = await createList({
      itemKind: "spotify_album",
      modules: ["ranking"],
      sources: [SPOTIFY],
    });
    const dup = await listRoutes.request(`/${body.list?.id}/duplicate`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({}),
    });
    const copy = (await dup.json()) as { list: List };
    expect(copy.list.modules).toEqual(["ranking"]);
    const withSources = await listRoutes.request(`/${body.list?.id}/duplicate`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ copySources: true }),
    });
    expect(((await withSources.json()) as { list: List }).list.modules).toEqual([
      "ranking",
      "sources",
    ]);
  });
});

describe("0057 data migration", () => {
  const sql = readFileSync("./drizzle/0057_list_features_per_kind.sql", "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  async function runMigration() {
    for (const statement of sql) await rows(statement);
  }

  async function insert(name: string, itemKind: string | null, modules: string) {
    const [row] = await rows<{ id: string }>(
      `INSERT INTO lists (name, emoji, color, share_slug, owner_id, modules, item_kind)
       VALUES ($1, '📝', 'slate', $1, $2, $3, $4) RETURNING id`,
      [name, owner, modules, itemKind],
    );
    return row?.id ?? "";
  }

  it("strips what the kind doesn't offer, derives sources, and is a no-op on re-run", async () => {
    const movieNoSource = await insert("m-nosrc", "movie", "{todo,ranking,sources}");
    const shelf = await insert("shelf", "spotify_album", "{ranking}");
    await rows(
      "INSERT INTO list_sources (list_id, kind, config) VALUES ($1, 'spotify_playlist', '{}')",
      [shelf],
    );
    const todoLetterboxd = await insert("todo-lb", "plain", "{todo,letterboxd}");
    const movieMatch = await insert("m-match", "movie", "{ranking,letterboxd}");
    const legacy = await insert("legacy", "link", "{leaderboard,sources,letterboxd}");
    const blank = await insert("blank", null, "{ranking}");
    await rows(
      `INSERT INTO items (list_id, title, kind, added_by, completed, position) VALUES
         ($1, 'kept', 'movie', $2, true, 1)`,
      [movieNoSource, owner],
    );
    const before = await rows("SELECT id, completed, position, order_key FROM items ORDER BY id");
    const updatedBefore = await rows("SELECT id, updated_at FROM lists ORDER BY id");

    await runMigration();
    expect(await modulesOf(movieNoSource)).toEqual(["todo", "ranking"]);
    expect(await modulesOf(shelf)).toEqual(["ranking", "sources"]);
    expect(await modulesOf(todoLetterboxd)).toEqual(["todo"]);
    expect(await modulesOf(movieMatch)).toEqual(["ranking", "sources", "letterboxd"]);
    expect(await sourceKinds(movieMatch)).toEqual(["letterboxd_match"]);
    expect(await modulesOf(legacy)).toEqual(["leaderboard", "sources", "letterboxd"]);
    expect(await modulesOf(blank)).toEqual(["ranking"]);
    expect(await rows("SELECT id, completed, position, order_key FROM items ORDER BY id")).toEqual(
      before,
    );
    expect(await rows("SELECT id, updated_at FROM lists ORDER BY id")).toEqual(updatedBefore);

    const snapshot = await rows("SELECT id, modules FROM lists ORDER BY id");
    const sourceCount = await rows("SELECT count(*)::int AS n FROM list_sources");
    await runMigration();
    expect(await rows("SELECT id, modules FROM lists ORDER BY id")).toEqual(snapshot);
    expect(await rows("SELECT count(*)::int AS n FROM list_sources")).toEqual(sourceCount);
  });
});
