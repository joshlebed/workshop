// Crews (`/v1/crews`) against PGlite with the real migrations: create + name
// rules, the public preview, join semantics (everyone befriends everyone,
// blocked pairs excepted, idempotent re-join, caps), the crew board's
// friends-only visibility, and leaving.

import { PGlite } from "@electric-sql/pglite";
import type {
  CreateCrewResponse,
  CrewBoardResponse,
  CrewPreview,
  JoinCrewResponse,
  MyCrewsResponse,
} from "@workshop/shared/crews";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { firstName, parseCrewName } from "../../lib/crews.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { crewRoutes } from "./crews.js";

const ann = "00000000-0000-4000-8000-0000000c0001";
const ben = "00000000-0000-4000-8000-0000000c0002";
const cat = "00000000-0000-4000-8000-0000000c0003";
const dan = "00000000-0000-4000-8000-0000000c0004"; // Ann blocked Dan
const eve = "00000000-0000-4000-8000-0000000c0005"; // Ann's friend, not in the crew
const gameA = "00000000-0000-4000-8000-0000000c00a1"; // higher is better
const gameB = "00000000-0000-4000-8000-0000000c00a2"; // lower is better
const DAY = "2026-11-25";

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

function call(method: string, path: string, asUser?: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (asUser) headers.Authorization = `Bearer ${signSession(asUser)}`;
  return crewRoutes.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createCrew(asUser: string, name: string): Promise<CreateCrewResponse["crew"]> {
  const res = await call("POST", "/", asUser, { name });
  expect(res.status).toBe(201);
  return ((await res.json()) as CreateCrewResponse).crew;
}

async function join(asUser: string, token: string): Promise<JoinCrewResponse> {
  const res = await call("POST", `/${token}/join`, asUser);
  expect(res.status).toBe(200);
  return (await res.json()) as JoinCrewResponse;
}

async function areFriends(a: string, b: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const rows = await sql(`SELECT 1 FROM friendships WHERE user_low = $1 AND user_high = $2`, [
    low,
    high,
  ]);
  return rows.length > 0;
}

async function newUser(id: string, name: string) {
  await sql(`INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)`, [
    id,
    `${id}@example.com`,
    name,
  ]);
}

let sunday: CreateCrewResponse["crew"];

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });

  await newUser(ann, "Ann Smith");
  await newUser(ben, "Ben");
  await newUser(cat, "Cat");
  await newUser(dan, "Dan");
  await newUser(eve, "Eve");
  await sql(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [ann, dan]);
  await sql(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [ann, eve]);
  await sql(
    `INSERT INTO games (id, normalized_url, url, title, score_direction) VALUES
       ($1, 'a.example', 'https://a.example', 'Alpha', 'desc'),
       ($2, 'b.example', 'https://b.example', 'Beta', 'asc')`,
    [gameA, gameB],
  );
  // Ben asked Cat to be friends before the crew existed.
  await sql(`INSERT INTO friend_requests (inviter_id, invitee_id) VALUES ($1, $2)`, [ben, cat]);
}, 60_000);

describe("crew name rules", () => {
  it("trims, and rejects blank, multi-line, too long and objectionable names", () => {
    expect(parseCrewName("  Sunday Puzzlers ")).toEqual({ ok: true, name: "Sunday Puzzlers" });
    expect(parseCrewName("   ")).toMatchObject({ ok: false, code: "CREW_NAME_INVALID" });
    expect(parseCrewName("a\nb")).toMatchObject({ ok: false, code: "CREW_NAME_INVALID" });
    expect(parseCrewName("x".repeat(41))).toMatchObject({ ok: false });
    expect(parseCrewName("x".repeat(40))).toMatchObject({ ok: true });
    expect(parseCrewName(7)).toMatchObject({ ok: false });
  });

  it("takes the first word of a display name", () => {
    expect(firstName("Ann Smith")).toBe("Ann");
    expect(firstName("  ")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});

describe("POST /v1/crews", () => {
  it("creates a crew with the creator as its first member and a /crew link", async () => {
    sunday = await createCrew(ann, "  Sunday Puzzlers ");
    expect(sunday).toMatchObject({
      name: "Sunday Puzzlers",
      memberCount: 1,
      isCreator: true,
      createdBy: { userId: ann, displayName: "Ann Smith" },
    });
    expect(sunday.url).toBe(`http://localhost:8081/crew/${sunday.token}`);
  });

  it("400s a bad name with a code the client can show", async () => {
    const blank = await call("POST", "/", ann, { name: "  " });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({ details: { code: "CREW_NAME_INVALID" } });
    const missing = await call("POST", "/", ann, {});
    expect(missing.status).toBe(400);
  });

  it("requires a session", async () => {
    expect((await call("POST", "/", undefined, { name: "x" })).status).toBe(401);
  });
});

describe("GET /v1/crews/:token (public preview)", () => {
  it("names the crew, its creator, its size and first names without a session", async () => {
    const res = await call("GET", `/${sunday.token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CrewPreview;
    expect(body).toEqual({
      crew: {
        id: sunday.id,
        name: "Sunday Puzzlers",
        memberCount: 1,
        maxMembers: 25,
        creator: { userId: ann, displayName: "Ann Smith" },
        memberFirstNames: ["Ann"],
      },
      viewer: null,
    });
  });

  it("tells a signed-in viewer whether they're in it", async () => {
    const mine = (await (await call("GET", `/${sunday.token}`, ann)).json()) as CrewPreview;
    expect(mine.viewer).toEqual({ isMember: true });
    const theirs = (await (await call("GET", `/${sunday.token}`, ben)).json()) as CrewPreview;
    expect(theirs.viewer).toEqual({ isMember: false });
  });

  it("404s an unknown or malformed token", async () => {
    expect((await call("GET", "/nope1234")).status).toBe(404);
    expect((await call("GET", "/bad-token!")).status).toBe(404);
  });
});

describe("POST /v1/crews/:token/join", () => {
  it("befriends every member: B then C makes three mutual friends", async () => {
    const b = await join(ben, sunday.token);
    expect(b).toMatchObject({ alreadyMember: false, friendshipsFormed: 1 });
    expect(b.crew.memberCount).toBe(2);
    expect(b.friends.map((f) => f.userId)).toEqual([ann]);

    const c = await join(cat, sunday.token);
    expect(c).toMatchObject({ alreadyMember: false, friendshipsFormed: 2 });
    expect(c.friends.map((f) => f.userId).sort()).toEqual([ann, ben].sort());

    expect(await areFriends(ann, ben)).toBe(true);
    expect(await areFriends(ann, cat)).toBe(true);
    expect(await areFriends(ben, cat)).toBe(true);

    const rows = await sql<{ user_id: string; friendships_formed: number }>(
      `SELECT user_id, friendships_formed FROM crew_members WHERE crew_id = $1 ORDER BY joined_at`,
      [sunday.id],
    );
    expect(rows.map((r) => [r.user_id, r.friendships_formed])).toEqual([
      [ann, 0],
      [ben, 1],
      [cat, 2],
    ]);
  });

  it("consumes a pending directed request the crew satisfied", async () => {
    const pending = await sql(
      `SELECT 1 FROM friend_requests WHERE inviter_id = $1 AND invitee_id = $2`,
      [ben, cat],
    );
    expect(pending).toHaveLength(0);
  });

  it("is a no-op on re-join and never re-forms a removed edge", async () => {
    await sql(`DELETE FROM friendships WHERE user_low = $1 AND user_high = $2`, [
      ben < cat ? ben : cat,
      ben < cat ? cat : ben,
    ]);
    const again = await join(cat, sunday.token);
    expect(again).toMatchObject({ alreadyMember: true, friendshipsFormed: 0 });
    expect(await areFriends(ben, cat)).toBe(false);
    await sql(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [
      ben < cat ? ben : cat,
      ben < cat ? cat : ben,
    ]);
  });

  it("joins a blocked pair to the crew without an edge between them", async () => {
    const d = await join(dan, sunday.token);
    expect(d.friendshipsFormed).toBe(2);
    expect(d.friends.map((f) => f.userId).sort()).toEqual([ben, cat].sort());
    expect(await areFriends(ann, dan)).toBe(false);
    expect(await areFriends(ben, dan)).toBe(true);
  });

  it("404s an unknown crew", async () => {
    expect((await call("POST", "/zzzz9999/join", ben)).status).toBe(404);
  });
});

describe("GET /v1/crews/mine", () => {
  it("lists my crews with their size", async () => {
    const res = await call("GET", "/mine", ben);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MyCrewsResponse;
    expect(body.limit).toBe(10);
    expect(body.crews).toHaveLength(1);
    expect(body.crews[0]).toMatchObject({
      id: sunday.id,
      memberCount: 4,
      isCreator: false,
      createdBy: { userId: ann },
    });
  });
});

describe("GET /v1/crews/:id/board", () => {
  beforeAll(async () => {
    const score = (game: string, user: string, value: number) =>
      sql(
        `INSERT INTO game_scores (game_id, user_id, period_key, score_value, score_raw, parse_status)
         VALUES ($1, $2, $3, $4, 'raw', 'score')`,
        [game, user, DAY, value],
      );
    await score(gameA, ann, 50);
    await score(gameA, ben, 80);
    await score(gameA, dan, 99);
    await score(gameA, eve, 70); // Ann's friend, not in the crew
    await score(gameB, cat, 3);
    await sql(`INSERT INTO user_games (user_id, game_id) VALUES ($1, $2)`, [ann, gameA]);
  });

  async function board(asUser: string): Promise<CrewBoardResponse> {
    const res = await call("GET", `/${sunday.id}/board?period=${DAY}`, asUser);
    expect(res.status).toBe(200);
    return (await res.json()) as CrewBoardResponse;
  }

  it("ranks crew members per game, most players first, and leaves non-members out", async () => {
    const body = await board(ann);
    expect(body.periodKey).toBe(DAY);
    expect(body.games.map((g) => g.game.title)).toEqual(["Alpha", "Beta"]);
    const alpha = body.games[0];
    expect(alpha?.inMyGames).toBe(true);
    // Dan is blocked by Ann (no edge, not shown); Eve isn't in the crew.
    expect(alpha?.entries.map((e) => [e.userId, e.rank])).toEqual([
      [ben, 1],
      [ann, 2],
    ]);
    expect(body.games[1]?.inMyGames).toBe(false);
  });

  it("leaves a blocked member out of the member list, both ways", async () => {
    const forAnn = await board(ann);
    expect(forAnn.members.map((m) => m.userId)).toEqual([ann, ben, cat]);
    expect(forAnn.members[0]).toMatchObject({ isViewer: true, isCreator: true });

    const forDan = await board(dan);
    expect(forDan.members.map((m) => m.userId)).toEqual([ben, cat, dan]);
    expect(forDan.games[0]?.entries.map((e) => e.userId)).toEqual([dan, ben]);
  });

  it("shows an unfriended member without their scores", async () => {
    await sql(`DELETE FROM friendships WHERE user_low = $1 AND user_high = $2`, [
      ann < ben ? ann : ben,
      ann < ben ? ben : ann,
    ]);
    const body = await board(ann);
    expect(body.members.find((m) => m.userId === ben)).toMatchObject({ isFriend: false });
    expect(body.games[0]?.entries.map((e) => e.userId)).toEqual([ann]);
    await sql(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [
      ann < ben ? ann : ben,
      ann < ben ? ben : ann,
    ]);
  });

  it("404s for someone outside the crew, a bad id or a bad period", async () => {
    expect((await call("GET", `/${sunday.id}/board`, eve)).status).toBe(404);
    expect((await call("GET", "/not-a-uuid/board", ann)).status).toBe(404);
    expect((await call("GET", `/${sunday.id}/board?period=`, ann)).status).toBe(400);
  });
});

describe("caps", () => {
  it("refuses a 26th member", async () => {
    const big = await createCrew(eve, "Big crew");
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = `00000000-0000-4000-8000-0000000d${String(i).padStart(4, "0")}`;
      ids.push(id);
      await newUser(id, `Player ${i}`);
    }
    for (const id of ids.slice(0, 24)) await join(id, big.token);
    const res = await call("POST", `/${big.token}/join`, ids[24]);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ details: { code: "crew_full" } });
  }, 60_000);

  it("caps one person at ten crews, created or joined", async () => {
    // Cat is in Sunday Puzzlers; nine more fills her up.
    for (let i = 0; i < 9; i++) await createCrew(cat, `Crew ${i}`);
    const create = await call("POST", "/", cat, { name: "One too many" });
    expect(create.status).toBe(409);
    expect(await create.json()).toMatchObject({ details: { code: "crew_limit" } });

    const other = await createCrew(ben, "Ben's other crew");
    const joinRes = await call("POST", `/${other.token}/join`, cat);
    expect(joinRes.status).toBe(409);
  }, 60_000);
});

describe("POST /v1/crews/:id/leave", () => {
  it("removes me but keeps the friendships; the last one out deletes the crew", async () => {
    const solo = await createCrew(eve, "Solo");
    const pair = await createCrew(ann, "Pair");
    await join(eve, pair.token);

    expect((await call("POST", `/${pair.id}/leave`, eve)).status).toBe(200);
    expect(await areFriends(ann, eve)).toBe(true);
    const left = (await (await call("GET", `/${pair.token}`)).json()) as CrewPreview;
    expect(left.crew.memberCount).toBe(1);

    expect((await call("POST", `/${solo.id}/leave`, eve)).status).toBe(200);
    expect((await call("GET", `/${solo.token}`)).status).toBe(404);
    expect((await call("POST", `/${solo.id}/leave`, eve)).status).toBe(404);
  });
});
