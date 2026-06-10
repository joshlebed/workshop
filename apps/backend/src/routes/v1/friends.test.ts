// Integration tests for the friends surface (G2a acceptance). Like
// games.test.ts these run the real SQL against in-memory PGlite with the
// actual drizzle/ migrations applied, because the acceptance criteria are DB
// behaviors: a symmetric idempotent edge, friend scores unioned into
// leaderboards, non-friends never visible, and discovery scoped to friends.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the mock so both routers' `getDb` resolves to PGlite.
import { friendRoutes } from "./friends.js";
import { gameRoutes } from "./games.js";

const me = "00000000-0000-4000-8000-000000000011";
const friend = "00000000-0000-4000-8000-000000000012";
const stranger = "00000000-0000-4000-8000-000000000013";
const PERIOD = "2026-06-10";

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

async function addGame(url: string, asUser: string): Promise<string> {
  const res = await gameRoutes.request("/", {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ url }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { game: { id: string } };
  return body.game.id;
}

async function postScore(gameId: string, asUser: string, scoreRaw: string) {
  const res = await gameRoutes.request(`/${gameId}/scores`, {
    method: "PUT",
    headers: authHeaders(asUser),
    body: JSON.stringify({ periodKey: PERIOD, scoreRaw }),
  });
  expect(res.status).toBe(200);
}

async function leaderboard(gameId: string, asUser: string) {
  const res = await gameRoutes.request(`/${gameId}/leaderboard?period=${PERIOD}`, {
    headers: authHeaders(asUser),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    entries: { userId: string; scoreValue: number | null; rank: number | null }[];
  };
}

async function discovery(asUser: string, friendParam?: string) {
  return gameRoutes.request(`/discovery${friendParam ? `?friend=${friendParam}` : ""}`, {
    headers: authHeaders(asUser),
  });
}

let inviteToken: string;

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
       ($2, 'friend@example.com', 'Friendly'),
       ($3, 'stranger@example.com', 'Stranger')`,
    [me, friend, stranger],
  );
}, 60_000);

describe("POST /v1/friends/invite", () => {
  it("mints a token and a URL containing it", async () => {
    const res = await friendRoutes.request("/invite", {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; url: string };
    expect(body.token).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(body.url).toContain(body.token);
    inviteToken = body.token;
  });

  it("requires auth", async () => {
    const res = await friendRoutes.request("/invite", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/friends/requests/:token — public preview", () => {
  it("previews the inviter without auth", async () => {
    const res = await friendRoutes.request(`/requests/${inviteToken}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      inviter: { userId: string; displayName: string | null };
      status: string;
    };
    expect(body.inviter).toEqual({ userId: me, displayName: "Me" });
    expect(body.status).toBe("pending");
  });

  it("404s an unknown token", async () => {
    const res = await friendRoutes.request("/requests/zzzzzzzz");
    expect(res.status).toBe(404);
  });

  it("404s a malformed token", async () => {
    const res = await friendRoutes.request("/requests/not%20a%20slug!!");
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/friends/requests/:token/accept", () => {
  it("rejects the inviter accepting their own invite", async () => {
    const res = await friendRoutes.request(`/requests/${inviteToken}/accept`, {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(400);
  });

  it("creates one canonical symmetric edge", async () => {
    const res = await friendRoutes.request(`/requests/${inviteToken}/accept`, {
      method: "POST",
      headers: authHeaders(friend),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      friend: { userId: string; displayName: string | null; friendsSince: string };
    };
    expect(body.friend.userId).toBe(me);
    expect(body.friend.displayName).toBe("Me");

    const edges = await rows<{ user_low: string; user_high: string }>(
      `SELECT user_low, user_high FROM friendships`,
    );
    expect(edges).toEqual([
      { user_low: me < friend ? me : friend, user_high: me < friend ? friend : me },
    ]);

    const request = await rows<{ status: string; invitee_id: string }>(
      `SELECT status, invitee_id FROM friend_requests WHERE token = $1`,
      [inviteToken],
    );
    expect(request[0]).toEqual({ status: "accepted", invitee_id: friend });
  });

  it("re-accepting by the same user is idempotent, not an error", async () => {
    const res = await friendRoutes.request(`/requests/${inviteToken}/accept`, {
      method: "POST",
      headers: authHeaders(friend),
    });
    expect(res.status).toBe(200);
    const count = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM friendships`);
    expect(count[0]?.n).toBe(1);
  });

  it("404s when a different user tries an already-used token", async () => {
    const res = await friendRoutes.request(`/requests/${inviteToken}/accept`, {
      method: "POST",
      headers: authHeaders(stranger),
    });
    expect(res.status).toBe(404);
    const count = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM friendships`);
    expect(count[0]?.n).toBe(1);
  });
});

describe("GET /v1/friends", () => {
  it("lists my friends (both directions of the edge)", async () => {
    const mine = await friendRoutes.request("/", { headers: authHeaders(me) });
    expect(mine.status).toBe(200);
    const myBody = (await mine.json()) as { friends: { userId: string }[] };
    expect(myBody.friends.map((f) => f.userId)).toEqual([friend]);

    const theirs = await friendRoutes.request("/", { headers: authHeaders(friend) });
    const theirBody = (await theirs.json()) as { friends: { userId: string }[] };
    expect(theirBody.friends.map((f) => f.userId)).toEqual([me]);

    const strangers = await friendRoutes.request("/", { headers: authHeaders(stranger) });
    const strangerBody = (await strangers.json()) as { friends: unknown[] };
    expect(strangerBody.friends).toEqual([]);
  });
});

describe("leaderboard union (G2a acceptance)", () => {
  let sharedGameId: string;

  it("a friend's score appears in my leaderboard for a shared game — a non-friend's never does", async () => {
    sharedGameId = await addGame("https://globle-game.com/", me);
    await addGame("https://globle-game.com/", friend);
    await addGame("https://globle-game.com/", stranger);
    await postScore(sharedGameId, me, "🌎 Jun 10, 2026 🌍\n⬜🟧🟥🟩 = 4");
    await postScore(sharedGameId, friend, "🌎 Jun 10, 2026 🌍\n🟥🟩 = 2");
    await postScore(sharedGameId, stranger, "🌎 Jun 10, 2026 🌍\n🟩 = 1");

    const board = await leaderboard(sharedGameId, me);
    expect(board.entries.map((e) => e.userId).sort()).toEqual([me, friend].sort());
    expect(board.entries.find((e) => e.userId === friend)).toMatchObject({
      scoreValue: 2,
      rank: 1,
    });
    expect(board.entries.find((e) => e.userId === me)).toMatchObject({ scoreValue: 4, rank: 2 });
    expect(board.entries.map((e) => e.userId)).not.toContain(stranger);
  });

  it("the GET /v1/games standings block unions friends too (and never non-friends)", async () => {
    const res = await gameRoutes.request(`/?period=${PERIOD}`, { headers: authHeaders(me) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: {
        gameId: string;
        standings: { entries: { userId: string }[]; viewerHasPlayed: boolean };
      }[];
    };
    const shared = body.games.find((g) => g.gameId === sharedGameId);
    expect(shared?.standings.viewerHasPlayed).toBe(true);
    const visible = shared?.standings.entries.map((e) => e.userId) ?? [];
    expect(visible.sort()).toEqual([me, friend].sort());
    expect(visible).not.toContain(stranger);
  });
});

describe("GET /v1/games/discovery", () => {
  let friendOnlyGameId: string;

  it("returns a friend's game I haven't added, with the friends who play it — never a non-friend's", async () => {
    friendOnlyGameId = await addGame("https://www.nytimes.com/games/wordle/index.html", friend);
    await addGame("https://travle.earth/", stranger);

    const res = await discovery(me);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      games: { game: { id: string }; friends: { userId: string; displayName: string | null }[] }[];
    };
    expect(body.games.map((g) => g.game.id)).toEqual([friendOnlyGameId]);
    expect(body.games[0]?.friends).toEqual([{ userId: friend, displayName: "Friendly" }]);
    // The shared game (already in my list) and the stranger's game are absent.
  });

  it("?friend= filters to that friend's games", async () => {
    const res = await discovery(me, friend);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: { game: { id: string } }[] };
    expect(body.games.map((g) => g.game.id)).toEqual([friendOnlyGameId]);
  });

  it("?friend= 404s for a non-friend", async () => {
    const res = await discovery(me, stranger);
    expect(res.status).toBe(404);
  });

  it("?friend= 404s for a malformed id", async () => {
    const res = await discovery(me, "not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("a user with no friends gets an empty list", async () => {
    const res = await discovery(stranger);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { games: unknown[] };
    expect(body.games).toEqual([]);
  });
});

describe("DELETE /v1/friends/:userId", () => {
  it("unfriending removes visibility everywhere (scores stay stored)", async () => {
    const shared = await rows<{ id: string }>(
      `SELECT id FROM games WHERE normalized_url = 'globle-game.com'`,
    );
    const sharedGameId = shared[0]?.id as string;

    const res = await friendRoutes.request(`/${friend}`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(200);

    const list = await friendRoutes.request("/", { headers: authHeaders(me) });
    const listBody = (await list.json()) as { friends: unknown[] };
    expect(listBody.friends).toEqual([]);

    const board = await leaderboard(sharedGameId, me);
    expect(board.entries.map((e) => e.userId)).toEqual([me]);

    const disc = await discovery(me);
    const discBody = (await disc.json()) as { games: unknown[] };
    expect(discBody.games).toEqual([]);

    // The ex-friend's scores are still stored — just not mutually visible.
    const scores = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_scores WHERE user_id = $1`,
      [friend],
    );
    expect(scores[0]?.n).toBe(1);
  });

  it("is idempotent and rejects self-unfriend", async () => {
    const again = await friendRoutes.request(`/${friend}`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    expect(again.status).toBe(200);

    const self = await friendRoutes.request(`/${me}`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    expect(self.status).toBe(400);
  });
});
