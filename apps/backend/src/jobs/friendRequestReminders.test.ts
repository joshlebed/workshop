// Pending friend-request recovery (onboarding spike #7): the 48h reminder,
// the 14-day expiry, re-send, the instrumentation events, and the 0066
// backfill rule — against real migrations on in-memory PGlite.

import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import { signSession } from "../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../db/client.js", () => ({
  getDb: () => testDb,
}));

// Never reach Expo from tests.
const { sendExpoPushMessages } = vi.hoisted(() => ({
  sendExpoPushMessages: vi.fn(async (messages: { to: string }[]) => ({
    sent: messages.length,
    failed: 0,
    prunedTokens: [] as string[],
    outcomes: messages.map((m) => ({
      to: m.to,
      status: "ok" as "ok" | "error" | "request_failed",
    })),
  })),
}));
vi.mock("../lib/expoPush.js", () => ({ sendExpoPushMessages }));

import { friendRoutes } from "../routes/v1/friends.js";
import {
  buildFriendReminderMessages,
  friendReminderBody,
  runFriendRequestReminderJob,
} from "./friendRequestReminders.js";

const sam = "00000000-0000-4000-8000-000000000701";
const riley = "00000000-0000-4000-8000-000000000702";
const quinn = "00000000-0000-4000-8000-000000000703";
const recipient = "00000000-0000-4000-8000-000000000704";
const nightOwl = "00000000-0000-4000-8000-000000000705";
const noToken = "00000000-0000-4000-8000-000000000706";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const result = await client.query<T>(query, params);
  return result.rows;
}

function authHeaders(asUser: string): Record<string, string> {
  return { Authorization: `Bearer ${signSession(asUser)}`, "Content-Type": "application/json" };
}

/** A fixed-offset zone whose local hour at `now` is `localHour`. */
function zoneWithLocalHour(now: Date, localHour: number): string {
  let offset = localHour - now.getUTCHours();
  if (offset < -12) offset += 24;
  if (offset > 14) offset -= 24;
  if (offset === 0) return "Etc/GMT";
  // POSIX sign: Etc/GMT-5 is UTC+5.
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

async function insertRequest(
  inviter: string,
  invitee: string,
  opts: { ageMs: number; expiresInMs?: number; remindedAgoMs?: number },
) {
  const now = Date.now();
  await rows(
    `INSERT INTO friend_requests (inviter_id, invitee_id, created_at, expires_at, reminded_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      inviter,
      invitee,
      new Date(now - opts.ageMs).toISOString(),
      new Date(now + (opts.expiresInMs ?? 14 * DAY - opts.ageMs)).toISOString(),
      opts.remindedAgoMs === undefined ? null : new Date(now - opts.remindedAgoMs).toISOString(),
    ],
  );
}

async function events(kind: string) {
  return rows<{ inviter_id: string; invitee_id: string }>(
    `SELECT inviter_id, invitee_id FROM friend_request_events WHERE kind = $1 ORDER BY created_at`,
    [kind],
  );
}

async function inbound(asUser: string) {
  const res = await friendRoutes.request("/requests", { headers: authHeaders(asUser) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { inbound: { userId: string }[] }).inbound.map((r) => r.userId);
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();
  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'sam@example.com', 'Sam'),
       ($2, 'riley@example.com', 'Riley'),
       ($3, 'quinn@example.com', 'Quinn'),
       ($4, 'recipient@example.com', 'Rec'),
       ($5, 'owl@example.com', 'Owl'),
       ($6, 'notoken@example.com', 'Nope')`,
    [sam, riley, quinn, recipient, nightOwl, noToken],
  );
  const now = new Date();
  await rows(
    `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone) VALUES
       ($1, 'ExponentPushToken[rec-a]', 'ios', $2),
       ($1, 'ExponentPushToken[rec-b]', 'ios', $2),
       ($3, 'ExponentPushToken[owl]', 'ios', $4)`,
    [recipient, zoneWithLocalHour(now, 14), nightOwl, zoneWithLocalHour(now, 3)],
  );
}, 60_000);

beforeEach(async () => {
  sendExpoPushMessages.mockClear();
  await rows(`DELETE FROM friend_requests WHERE invitee_id IS NOT NULL`);
  await rows(`DELETE FROM friend_request_events`);
  await rows(`DELETE FROM friendships`);
});

describe("friendReminderBody", () => {
  it("names one, two, or many senders", () => {
    expect(friendReminderBody(["Sam"])).toBe("Sam wants to be friends on HighScore");
    expect(friendReminderBody(["Sam", "Riley"])).toBe(
      "Sam and 1 other want to be friends on HighScore",
    );
    expect(friendReminderBody([null, "Riley", "Quinn"])).toBe(
      "Someone and 2 others want to be friends on HighScore",
    );
  });

  it("routes the tap to the Friends inbox", () => {
    const [message] = buildFriendReminderMessages([{ id: sam, displayName: "Sam" }], ["tok"]);
    expect(message?.data).toEqual({
      kind: "friend_request_reminder",
      userId: sam,
      url: "highscore:///friends",
    });
  });
});

describe("48h reminder", () => {
  it("pushes every device once per recipient, grouping senders, then never again", async () => {
    await insertRequest(sam, recipient, { ageMs: 3 * DAY });
    await insertRequest(riley, recipient, { ageMs: 50 * HOUR });
    await insertRequest(quinn, recipient, { ageMs: 10 * HOUR }); // too young

    const first = await runFriendRequestReminderJob();
    expect(first).toMatchObject({ due: 2, recipients: 1, reminded: 2, sent: 2, expired: 0 });
    expect(sendExpoPushMessages).toHaveBeenCalledTimes(1);
    const messages = sendExpoPushMessages.mock.calls[0]?.[0] as {
      to: string;
      body: string;
    }[];
    expect(messages.map((m) => m.to)).toEqual([
      "ExponentPushToken[rec-a]",
      "ExponentPushToken[rec-b]",
    ]);
    // Newest first: Riley's request is younger than Sam's.
    expect(messages[0]?.body).toBe("Riley and 1 other want to be friends on HighScore");
    expect((await events("reminded")).map((e) => e.inviter_id).sort()).toEqual([sam, riley].sort());
    const reminded = await rows<{ inviter_id: string }>(
      `SELECT inviter_id FROM friend_requests WHERE reminded_at IS NOT NULL ORDER BY inviter_id`,
    );
    expect(reminded.map((r) => r.inviter_id)).toEqual([sam, riley].sort());

    sendExpoPushMessages.mockClear();
    const second = await runFriendRequestReminderJob();
    expect(second).toMatchObject({ due: 0, reminded: 0 });
    expect(sendExpoPushMessages).not.toHaveBeenCalled();
  });

  it("waits for the recipient's daytime, and skips recipients with no push token", async () => {
    await insertRequest(sam, nightOwl, { ageMs: 3 * DAY });
    await insertRequest(sam, noToken, { ageMs: 3 * DAY });
    const result = await runFriendRequestReminderJob();
    expect(result).toMatchObject({ due: 1, outsideHours: 1, recipients: 0, reminded: 0 });
    expect(sendExpoPushMessages).not.toHaveBeenCalled();
    const unreminded = await rows(`SELECT 1 FROM friend_requests WHERE reminded_at IS NULL`);
    expect(unreminded).toHaveLength(2);
  });

  it("leaves rows un-reminded when Expo never answers", async () => {
    await insertRequest(sam, recipient, { ageMs: 3 * DAY });
    sendExpoPushMessages.mockImplementationOnce(async (messages: { to: string }[]) => ({
      sent: 0,
      failed: messages.length,
      prunedTokens: [] as string[],
      outcomes: messages.map((m) => ({ to: m.to, status: "request_failed" as const })),
    }));
    const result = await runFriendRequestReminderJob();
    expect(result).toMatchObject({ recipients: 1, reminded: 0, sent: 0 });
    expect(await events("reminded")).toHaveLength(0);
  });

  it("records an accept after the reminder", async () => {
    await insertRequest(sam, recipient, { ageMs: 3 * DAY, remindedAgoMs: HOUR });
    await insertRequest(riley, recipient, { ageMs: HOUR });
    for (const sender of [sam, riley]) {
      const res = await friendRoutes.request(`/requests/user/${sender}/accept`, {
        method: "POST",
        headers: authHeaders(recipient),
      });
      expect(res.status).toBe(200);
    }
    expect((await events("accepted_after_reminder")).map((e) => e.inviter_id)).toEqual([sam]);
    expect((await events("accepted")).map((e) => e.inviter_id)).toEqual([riley]);
  });

  it("records a recipient's decline after the reminder, not a sender's cancel", async () => {
    await insertRequest(sam, recipient, { ageMs: 3 * DAY, remindedAgoMs: HOUR });
    await insertRequest(riley, recipient, { ageMs: 3 * DAY, remindedAgoMs: HOUR });
    await friendRoutes.request(`/requests/user/${sam}`, {
      method: "DELETE",
      headers: authHeaders(recipient),
    });
    await friendRoutes.request(`/requests/user/${recipient}`, {
      method: "DELETE",
      headers: authHeaders(riley),
    });
    expect((await events("declined_after_reminder")).map((e) => e.inviter_id)).toEqual([sam]);
    expect(await rows(`SELECT 1 FROM friend_requests WHERE invitee_id = $1`, [recipient])).toEqual(
      [],
    );
  });
});

describe("14-day expiry", () => {
  it("expires a pending row past expires_at; it leaves the inbox at once, before the sweep", async () => {
    await insertRequest(sam, recipient, { ageMs: 15 * DAY, expiresInMs: -DAY });
    await insertRequest(riley, recipient, { ageMs: 13 * DAY, remindedAgoMs: 11 * DAY });

    // Already hidden from the recipient by the read-time predicate.
    expect(await inbound(recipient)).toEqual([riley]);

    const result = await runFriendRequestReminderJob();
    expect(result.expired).toBe(1);
    const statuses = await rows<{ inviter_id: string; status: string; responded_at: unknown }>(
      `SELECT inviter_id, status, responded_at FROM friend_requests
       WHERE invitee_id = $1 ORDER BY inviter_id`,
      [recipient],
    );
    expect(statuses.map((s) => [s.inviter_id, s.status])).toEqual(
      [
        [sam, "expired"],
        [riley, "pending"],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(statuses.find((s) => s.inviter_id === sam)?.responded_at).not.toBeNull();
    expect((await events("expired")).map((e) => e.inviter_id)).toEqual([sam]);
    expect(await inbound(recipient)).toEqual([riley]);

    // An expired row is never reminded.
    expect(sendExpoPushMessages).not.toHaveBeenCalled();
  });

  it("the sender's profile says expired; re-sending replaces the row and is recorded", async () => {
    await insertRequest(sam, recipient, { ageMs: 15 * DAY, expiresInMs: -DAY });
    await runFriendRequestReminderJob();
    // A shared friend so the profile isn't a stranger 404.
    for (const [a, b] of [
      [sam, quinn],
      [recipient, quinn],
    ] as const) {
      const [low, high] = a < b ? [a, b] : [b, a];
      await rows(`INSERT INTO friendships (user_low, user_high) VALUES ($1, $2)`, [low, high]);
    }

    const senderView = await friendRoutes.request(`/users/${recipient}`, {
      headers: authHeaders(sam),
    });
    const senderBody = (await senderView.json()) as {
      relationship: string;
      outboundExpiredAt: string | null;
    };
    expect(senderBody.relationship).toBe("none");
    expect(senderBody.outboundExpiredAt).not.toBeNull();

    // The recipient just sees no request.
    const recipientView = await friendRoutes.request(`/users/${sam}`, {
      headers: authHeaders(recipient),
    });
    const recipientBody = (await recipientView.json()) as {
      relationship: string;
      outboundExpiredAt: string | null;
    };
    expect(recipientBody).toMatchObject({ relationship: "none", outboundExpiredAt: null });

    const resend = await friendRoutes.request("/requests", {
      method: "POST",
      headers: authHeaders(sam),
      body: JSON.stringify({ userId: recipient }),
    });
    expect(resend.status).toBe(201);
    expect((await events("resent")).map((e) => e.inviter_id)).toEqual([sam]);
    const after = await rows<{ status: string; expires_at: Date }>(
      `SELECT status, expires_at FROM friend_requests WHERE inviter_id = $1 AND invitee_id = $2`,
      [sam, recipient],
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.status).toBe("pending");
    const ttlDays = (new Date(after[0]?.expires_at ?? 0).getTime() - Date.now()) / DAY;
    expect(ttlDays).toBeGreaterThan(13.9);
    expect(ttlDays).toBeLessThanOrEqual(14);
    expect(await inbound(recipient)).toEqual([sam]);

    const profile = await friendRoutes.request(`/users/${recipient}`, {
      headers: authHeaders(sam),
    });
    expect(((await profile.json()) as { relationship: string }).relationship).toBe("outbound");
  });

  it("an expired request still lets a sender with no mutuals open the profile", async () => {
    await insertRequest(riley, nightOwl, { ageMs: 15 * DAY, expiresInMs: -DAY });
    await runFriendRequestReminderJob();
    const sender = await friendRoutes.request(`/users/${nightOwl}`, {
      headers: authHeaders(riley),
    });
    expect(sender.status).toBe(200);
    expect(
      ((await sender.json()) as { outboundExpiredAt: string | null }).outboundExpiredAt,
    ).toBeTruthy();
    // The recipient gets no such vouch: a stranger's profile stays a 404.
    const recipient = await friendRoutes.request(`/users/${riley}`, {
      headers: authHeaders(nightOwl),
    });
    expect(recipient.status).toBe(404);
  });

  it("a block clears an expired row too", async () => {
    await insertRequest(sam, recipient, { ageMs: 15 * DAY, expiresInMs: -DAY });
    await runFriendRequestReminderJob();
    const { moderationRoutes } = await import("../routes/v1/moderation.js");
    const res = await moderationRoutes.request(`/users/${sam}/block`, {
      method: "POST",
      headers: authHeaders(recipient),
    });
    expect(res.status).toBeLessThan(300);
    expect(await rows(`SELECT 1 FROM friend_requests WHERE invitee_id = $1`, [recipient])).toEqual(
      [],
    );
    await rows(`DELETE FROM user_blocks`);
  });
});

describe("0066 backfill", () => {
  it("gives rows already pending at deploy a fresh 14-day clock instead of expiring them", async () => {
    // A 40-day-old request from before the column existed.
    await rows(
      `INSERT INTO friend_requests (inviter_id, invitee_id, created_at) VALUES ($1, $2, $3)`,
      [sam, recipient, new Date(Date.now() - 40 * DAY).toISOString()],
    );
    const sqlText = readFileSync("./drizzle/0066_friend_request_recovery.sql", "utf8");
    const backfill = sqlText
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .find((s) => s.includes(`UPDATE "friend_requests"`));
    expect(backfill).toBeDefined();
    await rows(backfill ?? "");

    const [row] = await rows<{ status: string; expires_at: Date }>(
      `SELECT status, expires_at FROM friend_requests WHERE inviter_id = $1`,
      [sam],
    );
    expect(row?.status).toBe("pending");
    const days = (new Date(row?.expires_at ?? 0).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(13.9);

    // The first run after deploy expires nothing and reminds it once.
    const result = await runFriendRequestReminderJob();
    expect(result).toMatchObject({ expired: 0, reminded: 1 });
  });
});
