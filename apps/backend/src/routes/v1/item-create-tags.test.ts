// Integration tests for tagging an item at create time (`POST /v1/lists/:id/items`
// with `tags`), which is what the add-item form posts. Runs the real SQL against
// in-memory PGlite with the actual drizzle/ migrations because the behavior under
// test is DB-shaped: the `item_tags` rows land in the same transaction as the
// insert, and the created item echoes back the canonical sorted set.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the mock so the router's `getDb` resolves to PGlite.
import { listRoutes } from "./lists.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const listId = "00000000-0000-4000-8000-0000000000a1";

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${signSession(ownerId)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

interface CreatedItem {
  id: string;
  title: string;
  tags: string[];
}

async function addItem(body: Record<string, unknown>) {
  const res = await listRoutes.request(`/${listId}/items`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { item?: CreatedItem; message?: string };
  return { status: res.status, item: json.item, message: json.message };
}

async function storedTags(itemId: string) {
  const found = await rows<{ tag: string }>(
    `SELECT tag FROM item_tags WHERE item_id = $1 ORDER BY tag`,
    [itemId],
  );
  return found.map((r) => r.tag);
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES ($1, 'owner@example.com', 'Owner')`,
    [ownerId],
  );
  await rows(
    `INSERT INTO lists (id, name, emoji, color, share_slug, owner_id)
       VALUES ($1, 'Food spots', '🍔', 'amber', 'food-spots', $2)`,
    [listId, ownerId],
  );
  await rows(`INSERT INTO list_members (list_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    listId,
    ownerId,
  ]);
}, 60_000);

describe("POST /v1/lists/:id/items — tags", () => {
  it("persists tags supplied at create time", async () => {
    const { status, item } = await addItem({
      title: "Crocodile burger",
      tags: ["burgers", "date"],
    });
    expect(status).toBe(201);
    expect(item?.tags).toEqual(["burgers", "date"]);
    expect(await storedTags(item?.id ?? "")).toEqual(["burgers", "date"]);
  });

  it("normalizes and dedupes before writing (no unique-constraint trip)", async () => {
    const { status, item } = await addItem({
      title: "Taco place",
      tags: ["  Tacos ", "TACOS", "Late   Night"],
    });
    expect(status).toBe(201);
    expect(item?.tags).toEqual(["late night", "tacos"]);
    expect(await storedTags(item?.id ?? "")).toEqual(["late night", "tacos"]);
  });

  it("creates an untagged item when tags are omitted or empty", async () => {
    const omitted = await addItem({ title: "No tags" });
    expect(omitted.status).toBe(201);
    expect(omitted.item?.tags).toEqual([]);

    const empty = await addItem({ title: "Empty tags", tags: [] });
    expect(empty.status).toBe(201);
    expect(empty.item?.tags).toEqual([]);
    expect(await storedTags(empty.item?.id ?? "")).toEqual([]);
  });

  it("rejects an invalid tag set without creating the item", async () => {
    const before = await rows<{ count: string }>(`SELECT count(*)::text AS count FROM items`);
    const { status } = await addItem({ title: "Too many", tags: ["a".repeat(41)] });
    expect(status).toBe(400);
    const after = await rows<{ count: string }>(`SELECT count(*)::text AS count FROM items`);
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it("surfaces new tags through GET /v1/lists/:id/tags", async () => {
    const res = await listRoutes.request(`/${listId}/tags`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: Array<{ tag: string; count: number }> };
    const byTag = new Map(body.tags.map((t) => [t.tag, Number(t.count)]));
    expect(byTag.get("burgers")).toBe(1);
    expect(byTag.get("tacos")).toBe(1);
  });
});
