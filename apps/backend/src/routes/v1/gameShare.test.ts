// Integration tests for the play-link surface (`/v1/game-share`). Runs the real
// SQL against in-memory PGlite with the actual drizzle/ migrations, because the
// behaviors under test are DB-shaped: per-(user, day) mint idempotency, the
// viewer-relative resolve (self / friend / stranger), and the friends-profile
// `?via=` vouch that lets a play-link recipient see a not-yet-friend's profile.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the mock so the routers' `getDb` resolves to PGlite.
import { friendRoutes } from "./friends.js";
import { __internal, gameShareRoutes } from "./gameShare.js";

const sharerId = "00000000-0000-4000-8000-000000000001";
const friendId = "00000000-0000-4000-8000-000000000002";
const strangerId = "00000000-0000-4000-8000-000000000003";

function authHeaders(asUser: string): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const res = await client.query<T>(query, params);
  return res.rows;
}

async function mint(asUser: string) {
  const res = await gameShareRoutes.request("/", { method: "POST", headers: authHeaders(asUser) });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; url: string };
}

type ResolvePayload = {
  user: { userId: string; displayName: string | null };
  viewer?: { isSelf: boolean; isFriend: boolean };
};

async function resolve(token: string, asUser?: string) {
  const res = await gameShareRoutes.request(
    `/${token}`,
    asUser ? { headers: authHeaders(asUser) } : undefined,
  );
  return { status: res.status, body: (await res.json()) as ResolvePayload };
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
       ($1, 'sharer@example.com', 'Sharer Sam'),
       ($2, 'friend@example.com', 'Friend Fran'),
       ($3, 'stranger@example.com', 'Stranger Stan')`,
    [sharerId, friendId, strangerId],
  );
  // Canonical friendship edge (user_low < user_high) between sharer and friend.
  const [low, high] = sharerId < friendId ? [sharerId, friendId] : [friendId, sharerId];
  await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
}, 60_000);

describe("POST /v1/game-share (mint)", () => {
  it("mints a play link as a short /g/:token URL", async () => {
    const link = await mint(sharerId);
    expect(link.token).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(link.url).toBe(`http://localhost:8082/g/${link.token}`);
    expect(__internal.gameShareUrl(link.token, false)).toBe(
      `https://highscore.live/g/${link.token}`,
    );
  });

  it("is idempotent within a day — re-minting returns the same token", async () => {
    const first = await mint(sharerId);
    const second = await mint(sharerId);
    expect(second.token).toBe(first.token);
    // Exactly one row for this (user, today) — no dead rows accumulate.
    const linkRows = await rows<{ n: number }>(
      `SELECT count(*)::int AS n FROM game_share_links WHERE user_id = $1`,
      [sharerId],
    );
    expect(linkRows[0]?.n).toBe(1);
  });

  it("rejects an unauthenticated mint", async () => {
    const res = await gameShareRoutes.request("/", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("GET /v1/game-share/:token (resolve)", () => {
  it("returns the sharer with no viewer block for an anonymous request (the OG path)", async () => {
    const { token } = await mint(sharerId);
    const { status, body } = await resolve(token);
    expect(status).toBe(200);
    expect(body.user).toEqual({ userId: sharerId, displayName: "Sharer Sam" });
    expect(body.viewer).toBeUndefined();
  });

  it("flags an existing friend as connected (→ Games home)", async () => {
    const { token } = await mint(sharerId);
    const { body } = await resolve(token, friendId);
    expect(body.viewer).toEqual({ isSelf: false, isFriend: true });
  });

  it("flags the sharer themselves as self (→ Games home)", async () => {
    const { token } = await mint(sharerId);
    const { body } = await resolve(token, sharerId);
    expect(body.viewer).toEqual({ isSelf: true, isFriend: false });
  });

  it("flags a stranger as neither (→ sharer's profile)", async () => {
    const { token } = await mint(sharerId);
    const { body } = await resolve(token, strangerId);
    expect(body.viewer).toEqual({ isSelf: false, isFriend: false });
  });

  it("404s an unknown token", async () => {
    const { status } = await resolve("doesnotexist");
    expect(status).toBe(404);
  });
});

describe("GET /v1/friends/users/:id?via= (play-link vouch)", () => {
  async function profile(targetId: string, asUser: string, via?: string) {
    const qs = via ? `?via=${encodeURIComponent(via)}` : "";
    const res = await friendRoutes.request(`/users/${targetId}${qs}`, {
      headers: authHeaders(asUser),
    });
    return res.status;
  }

  it("404s a stranger's profile with no relationship, no mutuals, no token", async () => {
    expect(await profile(sharerId, strangerId)).toBe(404);
  });

  it("opens the sharer's profile when vouched by a valid play-link token", async () => {
    const { token } = await mint(sharerId);
    expect(await profile(sharerId, strangerId, token)).toBe(200);
  });

  it("still 404s when the token belongs to a different user", async () => {
    const { token } = await mint(sharerId);
    // Token resolves to the sharer, but the viewer is asking for the friend's
    // profile — the vouch must be target-scoped, not a skeleton key.
    expect(await profile(friendId, strangerId, token)).toBe(404);
  });
});
