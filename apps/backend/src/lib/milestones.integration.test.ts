// Activation milestones end to end on PGlite with the real migrations: each
// write site records its row once, counts gate second friend / third game,
// the admin cohort loaders read them back, and the push-prompt telemetry
// route keeps a row for the funnel.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "./config.js";
import { signSession } from "./session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the DB mock.
import { meRoutes } from "../routes/v1/me.js";
import { pushPromptSchema, telemetryRoutes } from "../routes/v1/telemetry.js";
import { userRoutes } from "../routes/v1/users.js";
import { buildActivationCohorts, loadActivationInputs, loadPushFunnel } from "./adminActivation.js";
import { addFriendship } from "./friends.js";
import { recordScoreMilestones } from "./milestones.js";
import { runWithRequestClientContext } from "./requestContext.js";
import { addToMyGames } from "./userGames.js";

const ann = "00000000-0000-4000-8000-000000000301";
const bob = "00000000-0000-4000-8000-000000000302";
const cat = "00000000-0000-4000-8000-000000000303";

function authHeaders(userId: string): Record<string, string> {
  return { Authorization: `Bearer ${signSession(userId)}`, "Content-Type": "application/json" };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

async function milestonesOf(userId: string) {
  return rows<{ key: string; reached_at: Date; context: Record<string, unknown> }>(
    `SELECT key, reached_at, context FROM user_milestones WHERE user_id = $1 ORDER BY key`,
    [userId],
  );
}

const ios = { client: "highscore" as const, platform: "ios", appVersion: "1.3.0" };

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();
  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name, signup_source, created_at) VALUES
       ($1, 'ann@example.com', 'Ann', 'friend_invite', now() - interval '3 days'),
       ($2, 'bob@example.com', 'Bob', 'none', now() - interval '10 days'),
       ($3, 'cat@example.com', 'Cat', NULL, now() - interval '10 days')`,
    [ann, bob, cat],
  );
  await rows(
    `INSERT INTO user_activity_days (user_id, client, platform, app_version, day)
     SELECT id, 'highscore', 'ios', '1.3.0', current_date FROM users`,
  );
}, 60_000);

describe("friend milestones", () => {
  it("records first and second friend for both people, with the actor's client", async () => {
    await runWithRequestClientContext(ios, () => addFriendship(bob, ann, ann));
    expect((await milestonesOf(ann)).map((m) => m.key)).toEqual(["first_friend"]);
    const [annFirst] = await milestonesOf(ann);
    expect(annFirst?.context).toMatchObject({
      signup_source: "friend_invite",
      client: "highscore",
      platform: "ios",
      app_version: "1.3.0",
      by_self: true,
    });
    // The other side gets the row too, without the actor's client.
    const [bobFirst] = await milestonesOf(bob);
    expect(bobFirst?.context).toMatchObject({
      signup_source: "none",
      client: null,
      by_self: false,
    });

    await addFriendship(ann, cat, ann);
    expect((await milestonesOf(ann)).map((m) => m.key)).toEqual(["first_friend", "second_friend"]);
    // An existing edge records nothing new and never moves reached_at.
    const before = await milestonesOf(ann);
    expect(await addFriendship(cat, ann, cat)).toBe(false);
    expect(await milestonesOf(ann)).toEqual(before);
  });
});

describe("game milestones", () => {
  it("records first game on the first add and third game on the third", async () => {
    const games = await rows<{ id: string }>(`SELECT id FROM games ORDER BY id LIMIT 3`);
    const keys = async () =>
      (await milestonesOf(ann)).map((m) => m.key).filter((k) => k.includes("game"));
    await addToMyGames(ann, games[0]?.id ?? "");
    expect(await keys()).toEqual(["first_game"]);
    await addToMyGames(ann, games[0]?.id ?? ""); // re-add: no-op
    await addToMyGames(ann, games[1]?.id ?? "");
    expect(await keys()).toEqual(["first_game"]);
    await addToMyGames(ann, games[2]?.id ?? "");
    expect(await keys()).toEqual(["first_game", "third_game"]);
  });

  it("records first score (and the share-sheet one only for a share-sheet post)", async () => {
    await recordScoreMilestones(ann, "paste");
    const keys = async () => (await milestonesOf(ann)).map((m) => m.key);
    expect(await keys()).toContain("first_score");
    expect(await keys()).not.toContain("first_share_extension_score");
    await recordScoreMilestones(ann, "share_extension");
    expect(await keys()).toContain("first_share_extension_score");
  });
});

describe("push, reminders and share setup", () => {
  it("records push_granted on a token post and reminders_enabled only when turned on", async () => {
    const token = await meRoutes.request("/push-token", {
      method: "POST",
      headers: authHeaders(bob),
      body: JSON.stringify({
        expoPushToken: "ExponentPushToken[milestone-test]",
        platform: "ios",
        timezone: "America/New_York",
      }),
    });
    expect(token.status).toBe(200);
    const off = await meRoutes.request("/notification-prefs", {
      method: "PUT",
      headers: authHeaders(bob),
      body: JSON.stringify({ playReminderEnabled: false, playReminderHour: 9 }),
    });
    expect(off.status).toBe(200);
    let keys = (await milestonesOf(bob)).map((m) => m.key);
    expect(keys).toContain("push_granted");
    expect(keys).not.toContain("reminders_enabled");
    await meRoutes.request("/notification-prefs", {
      method: "PUT",
      headers: authHeaders(bob),
      body: JSON.stringify({ playReminderEnabled: true, playReminderHour: 9 }),
    });
    keys = (await milestonesOf(bob)).map((m) => m.key);
    expect(keys).toContain("reminders_enabled");
  });

  it("records share_setup_completed on the walkthrough's completedAt, not a dismissal", async () => {
    const put = (value: unknown) =>
      userRoutes.request("/me/flags/games.share-sheet-announcement", {
        method: "PUT",
        headers: authHeaders(cat),
        body: JSON.stringify({ value }),
      });
    expect((await put({ dismissedAt: new Date().toISOString() })).status).toBe(200);
    expect((await milestonesOf(cat)).map((m) => m.key)).not.toContain("share_setup_completed");
    expect((await put({ completedAt: new Date().toISOString() })).status).toBe(200);
    expect((await milestonesOf(cat)).map((m) => m.key)).toContain("share_setup_completed");
  });
});

describe("admin activation cohorts from real rows", () => {
  it("counts day-1 milestones within 24h of signup and the push funnel by trigger", async () => {
    const now = new Date();
    const inputs = await loadActivationInputs(testDb as never, now);
    expect(inputs.members.map((m) => m.userId).sort()).toEqual([ann, bob, cat]);
    // Ann signed up 3 days ago and reached everything today — after her first
    // 24h, so none of it counts as day 1.
    const cohorts = buildActivationCohorts(inputs.members, inputs.milestones, new Map(), now);
    const all = cohorts.weeks.reduce((n, w) => n + w.all.reached, 0);
    expect(all).toBe(0);
    expect(cohorts.bySource.map((s) => s.key)).toEqual(["friend_invite", "none", "unrecorded"]);

    for (const stage of ["shown", "accepted", "os_granted"]) {
      const res = await telemetryRoutes.request("/push-prompt", {
        method: "POST",
        headers: authHeaders(ann),
        body: JSON.stringify({ stage, trigger: "post_score" }),
      });
      expect(res.status).toBe(200);
    }
    const bad = await telemetryRoutes.request("/push-prompt", {
      method: "POST",
      headers: authHeaders(ann),
      body: JSON.stringify({ stage: "maybe", trigger: "post_score" }),
    });
    expect(bad.status).toBe(400);
    const funnel = await loadPushFunnel(testDb as never, new Date(now.getTime() - 86_400_000));
    expect(funnel.rows.map((r) => r.trigger)).toEqual(["post_score", "poke", "settings"]);
    expect(funnel.rows[0]?.stages).toEqual({ shown: 1, accepted: 1, os_granted: 1 });
    expect(pushPromptSchema.safeParse({ stage: "os_denied", trigger: "poke" }).success).toBe(true);
  });
});
