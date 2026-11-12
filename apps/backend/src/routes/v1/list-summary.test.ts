// Integration test for the home row fields on `GET /v1/lists` (UX pass 3.1):
// `openItemCount` (live, not completed) and `memberPreview` (up to three
// members other than the viewer, earliest joined first). Real SQL on PGlite.

import { PGlite } from "@electric-sql/pglite";
import type { ListSummary } from "@workshop/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { listRoutes } from "./lists.js";

const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const [viewer, a, b, c, d] = ids as [string, string, string, string, string];
const sharedListId = "00000000-0000-4000-8000-0000000000c1";
const soloListId = "00000000-0000-4000-8000-0000000000c2";

async function rows(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query(query, params)).rows;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'v@example.com', 'Viewer'), ($2, 'a@example.com', 'Ada'),
       ($3, 'b@example.com', 'Bo'), ($4, 'c@example.com', NULL), ($5, 'd@example.com', 'Dee')`,
    ids,
  );
  await rows(
    `INSERT INTO lists (id, name, emoji, color, share_slug, owner_id, modules, item_kind) VALUES
       ($1, 'Shared', '🎬', 'sunset', 'shared', $3, '{todo}', 'movie'),
       ($2, 'Solo', '📝', 'ocean', 'solo', $3, '{}', 'plain')`,
    [sharedListId, soloListId, viewer],
  );
  // Joined in the order d, a, b, c (viewer first) so the preview order is checked.
  await rows(
    `INSERT INTO list_members (list_id, user_id, role, joined_at) VALUES
       ($1, $2, 'owner', now() - interval '5 days'),
       ($1, $6, 'member', now() - interval '4 days'),
       ($1, $3, 'member', now() - interval '3 days'),
       ($1, $4, 'member', now() - interval '2 days'),
       ($1, $5, 'member', now() - interval '1 day'),
       ($7, $2, 'owner', now())`,
    [sharedListId, viewer, a, b, c, d, soloListId],
  );
  await rows(
    `INSERT INTO items (list_id, title, kind, added_by, completed, archived_at) VALUES
       ($1, 'Open one', 'movie', $2, false, NULL),
       ($1, 'Open two', 'movie', $2, false, NULL),
       ($1, 'Watched', 'movie', $2, true, NULL),
       ($1, 'Deleted', 'movie', $2, false, now())`,
    [sharedListId, viewer],
  );
}, 60_000);

describe("GET /v1/lists home-row fields", () => {
  it("counts open items and previews three other members, earliest first", async () => {
    const res = await listRoutes.request("/", {
      headers: { Authorization: `Bearer ${signSession(viewer)}` },
    });
    expect(res.status).toBe(200);
    const { lists } = (await res.json()) as { lists: ListSummary[] };
    const shared = lists.find((l) => l.id === sharedListId);
    const solo = lists.find((l) => l.id === soloListId);

    expect(shared?.itemCount).toBe(3);
    expect(shared?.openItemCount).toBe(2);
    expect(shared?.memberCount).toBe(5);
    expect(shared?.memberPreview).toEqual([
      { userId: d, displayName: "Dee" },
      { userId: a, displayName: "Ada" },
      { userId: b, displayName: "Bo" },
    ]);

    expect(solo?.openItemCount).toBe(0);
    expect(solo?.memberPreview).toEqual([]);
  });
});
