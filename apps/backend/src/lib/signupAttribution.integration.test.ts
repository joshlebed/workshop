// End-to-end over PGlite with the real migrations: a Google sign-in carrying
// `acquisition` records attribution on the new user (and only a new user), the
// 👋 ping says who invited them, and a referral-less signup's first friendship
// gets the 🧭 follow-up.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;
const pings: { content: string; kind: string | undefined }[] = [];

vi.mock("../db/client.js", () => ({ getDb: () => testDb }));
vi.mock("./discord.js", () => ({
  notifyDiscord: vi.fn(async (content: string, opts: { kind?: string } = {}) => {
    pings.push({ content, kind: opts.kind });
  }),
}));
vi.mock("./oauth/google.js", () => ({
  verifyGoogleIdentityToken: vi.fn(async ({ idToken }: { idToken: string }) => ({
    sub: `google-${idToken}`,
    email: `${idToken}@example.com`,
    name: idToken === "vienna" ? "Vienna Rinaldi" : `User ${idToken}`,
  })),
}));

import { authRoutes } from "../routes/v1/auth.js";
import { resetConfigForTesting } from "./config.js";
import { notifyFirstFriendAfterSignup } from "./opsNotifications.js";
import { runWithRequestClientContext } from "./requestContext.js";

const philipId = "00000000-0000-4000-8000-000000000001";

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

async function googleSignIn(idToken: string, acquisition?: unknown, platform = "ios") {
  const res = await runWithRequestClientContext(
    { client: "highscore", platform, appVersion: "1.2.0" },
    () =>
      authRoutes.request("/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(acquisition === undefined ? { idToken } : { idToken, acquisition }),
      }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

async function signupRow(userId: string) {
  const [row] = await rows<{
    signup_source: string | null;
    referred_by_user_id: string | null;
    signup_context: unknown;
  }>(`SELECT signup_source, referred_by_user_id, signup_context FROM users WHERE id = $1`, [
    userId,
  ]);
  return row;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.GOOGLE_WEB_CLIENT_ID = "test-client";
  process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.test/webhook";
  resetConfigForTesting();
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name, created_at) VALUES ($1, 'p@example.com', 'Philip', now() - interval '30 days')`,
    [philipId],
  );
  await rows(`INSERT INTO friend_requests (inviter_id, token) VALUES ($1, 'philinvite')`, [
    philipId,
  ]);
  await rows(
    `INSERT INTO game_share_links (user_id, date_key, token) VALUES ($1, '2026-11-09', 'philplay')`,
    [philipId],
  );
}, 60_000);

beforeEach(() => {
  pings.length = 0;
});

describe("signup attribution through POST /v1/auth/google", () => {
  it("records the friend-invite inviter and names them in the ping", async () => {
    const id = await googleSignIn("vienna", { friendInviteToken: "philinvite" });
    expect(await signupRow(id)).toEqual({
      signup_source: "friend_invite",
      referred_by_user_id: philipId,
      signup_context: { linkResolved: true },
    });
    expect(pings[0]?.content).toBe(
      "👋 new signup — Vienna Rinaldi via google — invited by Philip (friend invite link)",
    );
  });

  it("does not touch a returning user's attribution", async () => {
    const id = await googleSignIn("vienna", { gameShareToken: "philplay" });
    expect((await signupRow(id))?.signup_source).toBe("friend_invite");
    expect(pings[0]?.content).toBe("👤 signed in — Vienna Rinaldi via google");
  });

  it("records a play link", async () => {
    const id = await googleSignIn("player", { gameShareToken: "philplay" });
    expect((await signupRow(id))?.referred_by_user_id).toBe(philipId);
    expect(pings[0]?.content).toBe(
      "👋 new signup — User player via google — via Philip's play link",
    );
  });

  it("records web referral context", async () => {
    const id = await googleSignIn(
      "webby",
      {
        referrer: "https://news.ycombinator.com/item?id=9",
        landingPath: "/",
        utm: { source: "hn" },
      },
      "web",
    );
    expect(await signupRow(id)).toMatchObject({
      signup_source: "web_referral",
      referred_by_user_id: null,
      signup_context: {
        referrer: "https://news.ycombinator.com/item",
        landingPath: "/",
        utm: { source: "hn" },
      },
    });
    expect(pings[0]?.content).toBe(
      "👋 new signup — User webby via google — from news.ycombinator.com · utm_source=hn",
    );
  });

  it("says nothing was recorded for an empty acquisition, and leaves NULL for old clients", async () => {
    const direct = await googleSignIn("direct", {});
    expect((await signupRow(direct))?.signup_source).toBe("none");
    expect(pings[0]?.content).toBe(
      "👋 new signup — User direct via google — no referral recorded (App Store / direct)",
    );

    pings.length = 0;
    const old = await googleSignIn("oldclient");
    expect(await signupRow(old)).toEqual({
      signup_source: null,
      referred_by_user_id: null,
      signup_context: null,
    });
    expect(pings[0]?.content).toContain("no referral recorded (app version predates attribution)");
  });

  it("a malformed acquisition never fails the sign-in", async () => {
    const id = await googleSignIn("weird", { friendInviteToken: 12, utm: [1, 2] });
    expect((await signupRow(id))?.signup_source).toBe("none");
  });
});

describe("notifyFirstFriendAfterSignup", () => {
  async function befriend(a: string, b: string) {
    const [low, high] = a < b ? [a, b] : [b, a];
    await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
  }

  it("pings the first friend of a referral-less recent signup, once", async () => {
    const id = await googleSignIn("loner", {});
    await rows(`UPDATE users SET created_at = now() - interval '12 minutes' WHERE id = $1`, [id]);
    pings.length = 0;

    await befriend(id, philipId);
    await notifyFirstFriendAfterSignup(id, philipId);
    expect(pings).toEqual([
      {
        content:
          "🧭 first friend since signing up 12m ago — User loner ↔ Philip (no inviter recorded at signup)",
        kind: "signup_first_friend",
      },
    ]);

    // Second friend: not the first any more.
    pings.length = 0;
    const other = await googleSignIn("other", { gameShareToken: "philplay" });
    pings.length = 0;
    await befriend(id, other);
    await notifyFirstFriendAfterSignup(id, other);
    expect(pings).toEqual([]);
  });

  it("stays quiet for an invited signup or an old account", async () => {
    const invited = await googleSignIn("invited", { friendInviteToken: "philinvite" });
    const veteran = "00000000-0000-4000-8000-000000000099";
    await rows(
      `INSERT INTO users (id, email, display_name, created_at) VALUES ($1, 'v@example.com', 'Vet', now() - interval '3 days')`,
      [veteran],
    );
    pings.length = 0;
    await befriend(invited, veteran);
    await notifyFirstFriendAfterSignup(invited, veteran);
    expect(pings).toEqual([]);
  });
});
