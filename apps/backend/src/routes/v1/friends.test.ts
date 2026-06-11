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
// A second accepter, used to prove a friend link is reusable (not single-use).
const reuser = "00000000-0000-4000-8000-000000000014";
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
       ($3, 'stranger@example.com', 'Stranger'),
       ($4, 'reuser@example.com', 'Reuser')`,
    [me, friend, stranger, reuser],
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

  it("is idempotent — re-minting returns the same stable link", async () => {
    const res = await friendRoutes.request("/invite", {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    expect(body.token).toBe(inviteToken);
    const count = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM friend_requests WHERE inviter_id = $1`,
      [me],
    );
    expect(count[0]?.n).toBe(1);
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

    // The link is reusable, so accepting never consumes it — the row's
    // legacy single-use columns stay at their defaults.
    const request = await rows<{ status: string; invitee_id: string | null }>(
      `SELECT status, invitee_id FROM friend_requests WHERE token = $1`,
      [inviteToken],
    );
    expect(request[0]).toEqual({ status: "pending", invitee_id: null });
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

  it("is reusable — a different user can accept the same link", async () => {
    const res = await friendRoutes.request(`/requests/${inviteToken}/accept`, {
      method: "POST",
      headers: authHeaders(reuser),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { friend: { userId: string } };
    expect(body.friend.userId).toBe(me);

    // A second, independent edge now exists (me↔friend and me↔reuser).
    const count = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM friendships`);
    expect(count[0]?.n).toBe(2);

    // Clean up so the later visibility tests still see `friend` as my only
    // friend (and `stranger` / `reuser` as non-friends).
    const cleanup = await friendRoutes.request(`/${reuser}`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    expect(cleanup.status).toBe(200);
    const after = await rows<{ n: number }>(`SELECT count(*)::int AS n FROM friendships`);
    expect(after[0]?.n).toBe(1);
  });
});

describe("POST /v1/friends/invite/reset", () => {
  it("requires auth", async () => {
    const res = await friendRoutes.request("/invite/reset", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rotates the token on the same single row, invalidating the old link", async () => {
    const previous = inviteToken;
    const res = await friendRoutes.request("/invite/reset", {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; url: string };
    expect(body.token).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(body.token).not.toBe(previous);
    expect(body.url).toContain(body.token);

    // The slug rotated in place — still exactly one row for me.
    const count = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM friend_requests WHERE inviter_id = $1`,
      [me],
    );
    expect(count[0]?.n).toBe(1);

    // Old link is dead; the new link previews fine.
    const oldPreview = await friendRoutes.request(`/requests/${previous}`);
    expect(oldPreview.status).toBe(404);
    const newPreview = await friendRoutes.request(`/requests/${body.token}`);
    expect(newPreview.status).toBe(200);

    inviteToken = body.token;
  });

  it("the rotated link still works end-to-end (reusable as before)", async () => {
    // friend↔me already exists, so this re-accept is idempotent — but it must
    // still 200, proving the rotated slug accepts.
    const res = await friendRoutes.request(`/requests/${inviteToken}/accept`, {
      method: "POST",
      headers: authHeaders(friend),
    });
    expect(res.status).toBe(200);
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

// ---------------------------------------------------------------------------
// Directed friend requests + mutuals + profiles (the social-features pass).
// These run after the share-link suite above; at this point there are NO
// friendship edges (everything was unfriended), one share-link row for `me`,
// and games/scores from the leaderboard tests.
// ---------------------------------------------------------------------------

// Extra users for the mutuals graph.
const alice = "00000000-0000-4000-8000-000000000021";
const bob = "00000000-0000-4000-8000-000000000022";
const dave = "00000000-0000-4000-8000-000000000023";

async function insertGraphUsers() {
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'alice@example.com', 'Alice'),
       ($2, 'bob@example.com', 'Bob'),
       ($3, 'dave@example.com', 'Dave')
     ON CONFLICT (id) DO NOTHING`,
    [alice, bob, dave],
  );
}

async function addEdge(a: string, b: string) {
  const [lo, hi] = [a, b].sort() as [string, string];
  await rows(
    `INSERT INTO friendships (user_low, user_high) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [lo, hi],
  );
}

async function directedRowCount(): Promise<number> {
  const r = await rows<{ n: number }>(
    `SELECT count(*)::int AS n FROM friend_requests WHERE invitee_id IS NOT NULL`,
  );
  return r[0]?.n ?? 0;
}

async function sendRequest(asUser: string, toUser: string) {
  return friendRoutes.request("/requests", {
    method: "POST",
    headers: authHeaders(asUser),
    body: JSON.stringify({ userId: toUser }),
  });
}

async function listRequests(asUser: string) {
  const res = await friendRoutes.request("/requests", { headers: authHeaders(asUser) });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    inbound: { userId: string; displayName: string | null; requestedAt: string }[];
    outbound: { userId: string; displayName: string | null; requestedAt: string }[];
  };
}

describe("directed friend requests — send / list / accept / deny / cancel", () => {
  it("sending creates one pending request visible from both sides", async () => {
    const res = await sendRequest(friend, me);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; friend: unknown };
    expect(body).toEqual({ status: "pending", friend: null });

    const mine = await listRequests(me);
    expect(mine.inbound.map((r) => r.userId)).toEqual([friend]);
    expect(mine.inbound[0]?.displayName).toBe("Friendly");
    expect(mine.outbound).toEqual([]);

    const theirs = await listRequests(friend);
    expect(theirs.outbound.map((r) => r.userId)).toEqual([me]);
    expect(theirs.inbound).toEqual([]);
  });

  it("re-sending is idempotent — still one pending row", async () => {
    const res = await sendRequest(friend, me);
    expect(res.status).toBe(201);
    expect(await directedRowCount()).toBe(1);
  });

  it("rejects self-requests and unknown targets", async () => {
    const self = await sendRequest(me, me);
    expect(self.status).toBe(400);
    const unknown = await sendRequest(me, "00000000-0000-4000-8000-0000000000ff");
    expect(unknown.status).toBe(404);
  });

  it("share-link minting ignores directed rows", async () => {
    // `friend` has a directed row but no link row — minting must create a
    // fresh token, not reuse the directed request.
    const res = await friendRoutes.request("/invite", {
      method: "POST",
      headers: authHeaders(friend),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9]{8}$/);
    const linkRows = await rows<{ invitee_id: string | null }>(
      `SELECT invitee_id FROM friend_requests WHERE token = $1`,
      [body.token],
    );
    expect(linkRows[0]).toEqual({ invitee_id: null });
  });

  it("accepting forms the edge and consumes the request", async () => {
    const res = await friendRoutes.request(`/requests/user/${friend}/accept`, {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      friend: { userId: string; displayName: string | null; friendsSince: string };
    };
    expect(body.friend.userId).toBe(friend);
    expect(body.friend.displayName).toBe("Friendly");

    expect(await directedRowCount()).toBe(0);
    const mine = await listRequests(me);
    expect(mine.inbound).toEqual([]);
    const list = await friendRoutes.request("/", { headers: authHeaders(me) });
    const listBody = (await list.json()) as { friends: { userId: string }[] };
    expect(listBody.friends.map((f) => f.userId)).toEqual([friend]);
  });

  it("accept 404s when nothing is pending", async () => {
    const res = await friendRoutes.request(`/requests/user/${stranger}/accept`, {
      method: "POST",
      headers: authHeaders(me),
    });
    expect(res.status).toBe(404);
  });

  it("sending to an existing friend returns accepted without a new row", async () => {
    const res = await sendRequest(me, friend);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; friend: { friendsSince: string } };
    expect(body.status).toBe("accepted");
    expect(body.friend.friendsSince).toBeTruthy();
    expect(await directedRowCount()).toBe(0);
  });

  it("deny silently deletes and the sender can re-request", async () => {
    const sent = await sendRequest(stranger, me);
    expect(sent.status).toBe(201);

    const deny = await friendRoutes.request(`/requests/user/${stranger}`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    expect(deny.status).toBe(200);
    expect(await directedRowCount()).toBe(0);

    // No edge was formed, and re-requesting works.
    const again = await sendRequest(stranger, me);
    expect(again.status).toBe(201);
    expect(await directedRowCount()).toBe(1);
  });

  it("the sender can cancel their own outbound request", async () => {
    const cancel = await friendRoutes.request(`/requests/user/${me}`, {
      method: "DELETE",
      headers: authHeaders(stranger),
    });
    expect(cancel.status).toBe(200);
    expect(await directedRowCount()).toBe(0);
  });

  it("cross-requests auto-accept", async () => {
    const first = await sendRequest(reuser, me);
    expect(first.status).toBe(201);

    const second = await sendRequest(me, reuser);
    expect(second.status).toBe(201);
    const body = (await second.json()) as { status: string; friend: { userId: string } };
    expect(body.status).toBe("accepted");
    expect(body.friend.userId).toBe(reuser);

    expect(await directedRowCount()).toBe(0);
    const list = await friendRoutes.request("/", { headers: authHeaders(me) });
    const listBody = (await list.json()) as { friends: { userId: string }[] };
    expect(listBody.friends.map((f) => f.userId).sort()).toEqual([friend, reuser].sort());
  });

  it("a share-link accept consumes a pending directed request", async () => {
    await insertGraphUsers();
    const sent = await sendRequest(dave, me);
    expect(sent.status).toBe(201);

    // Dave then opens my reusable link instead of waiting.
    const res = await friendRoutes.request(`/requests/${inviteToken}/accept`, {
      method: "POST",
      headers: authHeaders(dave),
    });
    expect(res.status).toBe(200);
    expect(await directedRowCount()).toBe(0);
    const mine = await listRequests(me);
    expect(mine.inbound).toEqual([]);
  });
});

describe("GET /v1/friends/mutuals", () => {
  it("ranks friends-of-friends by mutual count with named connectors", async () => {
    // My friends at this point: friend, reuser, dave.
    await addEdge(alice, friend);
    await addEdge(alice, reuser);
    await addEdge(bob, friend);

    const res = await friendRoutes.request("/mutuals", { headers: authHeaders(me) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mutuals: {
        userId: string;
        displayName: string | null;
        mutualCount: number;
        mutualFriends: { userId: string; displayName: string | null }[];
      }[];
    };
    expect(body.mutuals.map((m) => m.userId)).toEqual([alice, bob]);
    expect(body.mutuals[0]).toMatchObject({ displayName: "Alice", mutualCount: 2 });
    expect(body.mutuals[0]?.mutualFriends.map((f) => f.displayName)).toEqual([
      "Friendly",
      "Reuser",
    ]);
    expect(body.mutuals[1]).toMatchObject({ displayName: "Bob", mutualCount: 1 });
    // Existing friends and the viewer never appear as candidates.
    const ids = body.mutuals.map((m) => m.userId);
    for (const known of [me, friend, reuser, dave]) expect(ids).not.toContain(known);
  });

  it("a user with no friends has no mutuals", async () => {
    const res = await friendRoutes.request("/mutuals", { headers: authHeaders(stranger) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mutuals: unknown[] };
    expect(body.mutuals).toEqual([]);
  });
});

describe("GET /v1/friends/users/:userId — profile", () => {
  it("a friend's profile carries games with the period score + viewer overlap", async () => {
    const res = await friendRoutes.request(`/users/${friend}?period=${PERIOD}`, {
      headers: authHeaders(me),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { userId: string; displayName: string | null };
      relationship: string;
      friendsSince: string | null;
      periodKey: string;
      games: {
        game: { title: string };
        viewerHasGame: boolean;
        score: { scoreValue: number | null } | null;
      }[];
    };
    expect(body.user).toEqual({ userId: friend, displayName: "Friendly" });
    expect(body.relationship).toBe("friends");
    expect(body.friendsSince).toBeTruthy();
    expect(body.periodKey).toBe(PERIOD);
    // Friend has Globle (scored 2, which I also have) and Wordle (unplayed).
    expect(body.games).toHaveLength(2);
    const globle = body.games.find((g) => g.game.title === "Globle");
    const wordle = body.games.find((g) => g.game.title === "Wordle");
    expect(globle).toMatchObject({ viewerHasGame: true, score: { scoreValue: 2 } });
    expect(wordle).toMatchObject({ viewerHasGame: false, score: null });
  });

  it("my own profile reads as self with games attached", async () => {
    const res = await friendRoutes.request(`/users/${me}`, { headers: authHeaders(me) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { relationship: string; games: unknown[] | null };
    expect(body.relationship).toBe("self");
    expect(Array.isArray(body.games)).toBe(true);
  });

  it("a mutual's profile is visible but withholds games", async () => {
    const res = await friendRoutes.request(`/users/${alice}`, { headers: authHeaders(me) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      relationship: string;
      games: unknown;
      mutualFriends: { displayName: string | null }[];
    };
    expect(body.relationship).toBe("none");
    expect(body.games).toBeNull();
    expect(body.mutualFriends.map((f) => f.displayName).sort()).toEqual(["Friendly", "Reuser"]);
  });

  it("reflects outbound/inbound pending requests", async () => {
    const sent = await sendRequest(me, alice);
    expect(sent.status).toBe(201);

    const outbound = await friendRoutes.request(`/users/${alice}`, { headers: authHeaders(me) });
    expect(((await outbound.json()) as { relationship: string }).relationship).toBe("outbound");

    const inbound = await friendRoutes.request(`/users/${me}`, { headers: authHeaders(alice) });
    expect(((await inbound.json()) as { relationship: string }).relationship).toBe("inbound");

    // Clean up the pending request.
    const cancel = await friendRoutes.request(`/requests/user/${alice}`, {
      method: "DELETE",
      headers: authHeaders(me),
    });
    expect(cancel.status).toBe(200);
  });

  it("404s a stranger with no relationship and no mutuals (and bad ids)", async () => {
    const res = await friendRoutes.request(`/users/${stranger}`, { headers: authHeaders(me) });
    expect(res.status).toBe(404);

    const malformed = await friendRoutes.request("/users/not-a-uuid", {
      headers: authHeaders(me),
    });
    expect(malformed.status).toBe(404);

    const missing = await friendRoutes.request("/users/00000000-0000-4000-8000-0000000000fe", {
      headers: authHeaders(me),
    });
    expect(missing.status).toBe(404);
  });

  it("rejects an invalid period", async () => {
    const res = await friendRoutes.request(`/users/${friend}?period=bad%20period!!`, {
      headers: authHeaders(me),
    });
    expect(res.status).toBe(400);
  });
});
