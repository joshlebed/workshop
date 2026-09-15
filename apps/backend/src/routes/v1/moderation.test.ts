// Block + report surface (App Store Review Guideline 1.2), against in-memory
// PGlite with the real migrations. The acceptance criteria are DB behaviors:
// a block drops the friendship edge and every pending request, hides the pair
// from each other's leaderboards, refuses every friend-forming path in both
// directions, and a report lands a row with a content snapshot.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { friendRoutes } from "./friends.js";
import { gameRoutes } from "./games.js";
import { moderationRoutes } from "./moderation.js";
import { userRoutes } from "./users.js";

const me = "00000000-0000-4000-8000-000000000031";
const troll = "00000000-0000-4000-8000-000000000032";
const mutual = "00000000-0000-4000-8000-000000000033";
const PERIOD = "2026-09-10";

function authHeaders(asUser: string): Record<string, string> {
  return {
    Authorization: `Bearer ${signSession(asUser)}`,
    "Content-Type": "application/json",
  };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function addEdge(a: string, b: string) {
  const [lo, hi] = [a, b].sort() as [string, string];
  await rows(
    `INSERT INTO friendships (user_low, user_high) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [lo, hi],
  );
}

let gameId: string;

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'me@example.com', 'Me'),
       ($2, 'troll@example.com', 'Troll'),
       ($3, 'mutual@example.com', 'Mutual')`,
    [me, troll, mutual],
  );
  await addEdge(me, troll);
  await addEdge(troll, mutual);
  await addEdge(me, mutual);

  const res = await gameRoutes.request("/", {
    method: "POST",
    headers: authHeaders(me),
    body: JSON.stringify({ url: "https://globle-game.com" }),
  });
  expect(res.status).toBe(201);
  gameId = ((await res.json()) as { game: { id: string } }).game.id;
  for (const who of [me, troll]) {
    const score = await gameRoutes.request(`/${gameId}/scores`, {
      method: "PUT",
      headers: authHeaders(who),
      body: JSON.stringify({
        periodKey: PERIOD,
        scoreRaw: "🌎 Sep 10 🌍\n🔥 1 | Avg. Guesses: 4\n🟩 = 4",
      }),
    });
    expect(score.status).toBe(200);
  }
}, 60_000);

async function boardUserIds(asUser: string): Promise<string[]> {
  const res = await gameRoutes.request(`/${gameId}/leaderboard?period=${PERIOD}`, {
    headers: authHeaders(asUser),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { entries: { userId: string }[] };
  return body.entries.map((e) => e.userId);
}

describe("content filter on writes", () => {
  it("rejects a slur in a display name", async () => {
    const res = await userRoutes.request("/me", {
      method: "PATCH",
      headers: authHeaders(troll),
      body: JSON.stringify({ displayName: "n1gger" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a slur in a score paste but accepts a normal result", async () => {
    const bad = await gameRoutes.request(`/${gameId}/scores`, {
      method: "PUT",
      headers: authHeaders(troll),
      body: JSON.stringify({ periodKey: PERIOD, scoreRaw: "you faggot 3/6" }),
    });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { details?: { code?: string } };
    expect(body.details?.code).toBe("OBJECTIONABLE_CONTENT");
  });
});

describe("POST /v1/reports", () => {
  it("stores a profile report with a name snapshot", async () => {
    const res = await moderationRoutes.request("/reports", {
      method: "POST",
      headers: authHeaders(me),
      body: JSON.stringify({ targetUserId: troll, contentKind: "profile", reason: "offensive" }),
    });
    expect(res.status).toBe(201);
    const saved = await rows<{ content_snapshot: string; content_kind: string }>(
      `SELECT content_snapshot, content_kind FROM content_reports WHERE target_user_id = $1`,
      [troll],
    );
    expect(saved).toEqual([{ content_snapshot: "Troll", content_kind: "profile" }]);
  });

  it("stores a score report with the pasted text", async () => {
    const res = await moderationRoutes.request("/reports", {
      method: "POST",
      headers: authHeaders(me),
      body: JSON.stringify({
        targetUserId: troll,
        contentKind: "score",
        reason: "abusive",
        gameId,
        periodKey: PERIOD,
        details: "  rude  ",
      }),
    });
    expect(res.status).toBe(201);
    const saved = await rows<{ content_snapshot: string; details: string }>(
      `SELECT content_snapshot, details FROM content_reports WHERE content_kind = 'score'`,
    );
    expect(saved[0]?.content_snapshot).toContain("Avg. Guesses");
    expect(saved[0]?.details).toBe("rude");
  });

  it("rejects a score report without a location, and self-reports", async () => {
    const noLoc = await moderationRoutes.request("/reports", {
      method: "POST",
      headers: authHeaders(me),
      body: JSON.stringify({ targetUserId: troll, contentKind: "score", reason: "abusive" }),
    });
    expect(noLoc.status).toBe(400);
    const self = await moderationRoutes.request("/reports", {
      method: "POST",
      headers: authHeaders(me),
      body: JSON.stringify({ targetUserId: me, contentKind: "profile", reason: "other" }),
    });
    expect(self.status).toBe(400);
  });
});

describe("POST /v1/users/:id/block", () => {
  it("drops the friendship and removes the pair from each other's boards", async () => {
    expect(await boardUserIds(me)).toContain(troll);

    const res = await moderationRoutes.request(`/users/${troll}/block`, {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(201);

    expect(await boardUserIds(me)).toEqual([me]);
    expect(await boardUserIds(troll)).toEqual([troll]);

    const edges = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM friendships WHERE user_low = $1 OR user_high = $1`,
      [troll],
    );
    expect(edges[0]?.n).toBe(1); // only troll ↔ mutual survives
  });

  it("is idempotent (200 on repeat) and lists the block", async () => {
    const again = await moderationRoutes.request(`/users/${troll}/block`, {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(again.status).toBe(200);
    const list = await moderationRoutes.request("/users/me/blocks", { headers: authHeaders(me) });
    const body = (await list.json()) as { blocked: { userId: string; displayName: string }[] };
    expect(body.blocked).toEqual([
      expect.objectContaining({ userId: troll, displayName: "Troll" }),
    ]);
  });

  it("refuses friend requests, accepts and profile views in both directions", async () => {
    for (const [from, to] of [
      [me, troll],
      [troll, me],
    ] as const) {
      const send = await friendRoutes.request("/requests", {
        method: "POST",
        headers: authHeaders(from),
        body: JSON.stringify({ userId: to }),
      });
      expect(send.status).toBe(404);
      const profile = await friendRoutes.request(`/users/${to}`, { headers: authHeaders(from) });
      expect(profile.status).toBe(404);
    }

    // The blocked user's invite link can't be used by the blocker either.
    const invite = await friendRoutes.request("/invite", {
      method: "POST",
      headers: authHeaders(troll),
    });
    const { token } = (await invite.json()) as { token: string };
    const accept = await friendRoutes.request(`/requests/${token}/accept`, {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(accept.status).toBe(404);

    // Mutuals never suggest the blocked user, even via a shared friend.
    const mutuals = await friendRoutes.request("/mutuals", { headers: authHeaders(me) });
    const mBody = (await mutuals.json()) as { mutuals: { userId: string }[] };
    expect(mBody.mutuals.map((m) => m.userId)).not.toContain(troll);
  });

  it("clears pending requests on block and rejects self-block", async () => {
    await moderationRoutes.request(`/users/${troll}/block`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    const send = await friendRoutes.request("/requests", {
      method: "POST",
      headers: authHeaders(troll),
      body: JSON.stringify({ userId: me }),
    });
    expect(send.status).toBe(201);
    await moderationRoutes.request(`/users/${troll}/block`, {
      method: "POST",
      headers: authHeaders(me),
    });
    const pending = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM friend_requests WHERE invitee_id IS NOT NULL AND status = 'pending'`,
    );
    expect(pending[0]?.n).toBe(0);

    const self = await moderationRoutes.request(`/users/${me}/block`, {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(self.status).toBe(400);
  });

  it("unblock removes the row but does not restore the friendship", async () => {
    const res = await moderationRoutes.request(`/users/${troll}/block`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(200);
    const list = await moderationRoutes.request("/users/me/blocks", { headers: authHeaders(me) });
    expect(((await list.json()) as { blocked: unknown[] }).blocked).toEqual([]);
    expect(await boardUserIds(me)).toEqual([me]);
  });
});
