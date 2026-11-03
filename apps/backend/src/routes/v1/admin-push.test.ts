// The operator push panel: `GET /v1/admin/push/recipients` and
// `POST /v1/admin/push/send`. Real SQL against PGlite with the actual drizzle/
// migrations; Expo is a mocked global fetch — nothing leaves the process.

import { PGlite } from "@electric-sql/pglite";
import type { AdminPushRecipientsResponse, AdminPushSendResponse } from "@workshop/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { adminRoutes } from "./admin.js";

const adminId = "00000000-0000-4000-8000-000000000801";
const aliceId = "00000000-0000-4000-8000-000000000802";
const bobId = "00000000-0000-4000-8000-000000000803";
const carolId = "00000000-0000-4000-8000-000000000804";
const noTokenId = "00000000-0000-4000-8000-000000000805";
const bulkId = "00000000-0000-4000-8000-000000000806";

const STUB_URL = "http://127.0.0.1:9/push-stub";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
const asAdmin = () => headers(signSession(adminId));
const asPlayer = () => headers(signSession(aliceId));

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

function parseMessages(body: unknown): Array<Record<string, unknown>> {
  const parsed = JSON.parse(String(body));
  if (!Array.isArray(parsed)) throw new TypeError("expected an Expo message array");
  return parsed as Array<Record<string, unknown>>;
}

function tickets(data: unknown[]): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const message = {
  userIds: [aliceId, bobId],
  title: "New game",
  body: "Krillion is on the catalog",
  confirm: "SEND",
};

function send(body: unknown, h: Record<string, string> = asAdmin()) {
  return adminRoutes.request("/push/send", {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
}

async function recipients(query = "", h: Record<string, string> = asAdmin()) {
  return adminRoutes.request(`/push/recipients${query}`, { headers: h });
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.EXPO_PUSH_URL = STUB_URL;
  resetConfigForTesting();
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh'),
       ($2, 'alice@example.com', 'Alice Anders'),
       ($3, 'bob@example.com', 'Bob'),
       ($4, 'carol@example.com', 'Carol_50%'),
       ($5, 'none@example.com', 'No Token'),
       ($6, 'bulk@example.com', 'Bulk')`,
    [adminId, aliceId, bobId, carolId, noTokenId, bulkId],
  );
  await rows(
    `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone, last_seen_at) VALUES
       ($1, 'ExpoPushToken[alice-1]', 'ios', 'UTC', '2026-11-01T10:00:00Z'),
       ($1, 'ExpoPushToken[alice-2]', 'ios', 'UTC', '2026-11-02T10:00:00Z'),
       ($2, 'ExpoPushToken[bob-1]', 'ios', 'UTC', '2026-11-03T10:00:00Z'),
       ($3, 'ExpoPushToken[carol-1]', 'android', 'UTC', '2026-10-01T10:00:00Z')`,
    [aliceId, bobId, carolId],
  );
  await rows(
    `INSERT INTO notification_prefs (user_id, play_reminder_enabled, play_reminder_hour)
     VALUES ($1, true, 9), ($2, false, NULL)`,
    [aliceId, bobId],
  );
}, 60_000);

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /v1/admin/push/recipients", () => {
  it("401s with no session and 403s a non-admin", async () => {
    expect((await adminRoutes.request("/push/recipients")).status).toBe(401);
    expect((await recipients("", asPlayer())).status).toBe(403);
  });

  it("lists only users with a token, newest device first", async () => {
    const res = await recipients();
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminPushRecipientsResponse;
    expect(body.total).toBe(3);
    expect(body.recipients.map((r) => r.id)).toEqual([bobId, aliceId, carolId]);
    expect(body.recipients[1]).toEqual({
      id: aliceId,
      displayName: "Alice Anders",
      email: "alice@example.com",
      platforms: ["ios"],
      tokenCount: 2,
      lastSeenAt: "2026-11-02T10:00:00.000Z",
      playReminderEnabled: true,
    });
    // No notification_prefs row reads as reminders off.
    expect(body.recipients[2]).toMatchObject({
      platforms: ["android"],
      playReminderEnabled: false,
    });
  });

  it("filters case-insensitively on name or email, with LIKE wildcards literal", async () => {
    const byName = (await (await recipients("?q=aNDERS")).json()) as AdminPushRecipientsResponse;
    expect(byName.recipients.map((r) => r.id)).toEqual([aliceId]);
    const byEmail = (await (
      await recipients("?q=bob%40example")
    ).json()) as AdminPushRecipientsResponse;
    expect(byEmail.recipients.map((r) => r.id)).toEqual([bobId]);
    const literal = (await (await recipients("?q=_50%25")).json()) as AdminPushRecipientsResponse;
    expect(literal.recipients.map((r) => r.id)).toEqual([carolId]);
    const wildcard = (await (await recipients("?q=%25")).json()) as AdminPushRecipientsResponse;
    expect(wildcard.recipients.map((r) => r.id)).toEqual([carolId]);
  });

  it("remindersOnly=1 drops users with the reminder off", async () => {
    const body = (await (
      await recipients("?remindersOnly=1")
    ).json()) as AdminPushRecipientsResponse;
    expect(body.recipients.map((r) => r.id)).toEqual([aliceId]);
    expect(body.total).toBe(1);
  });
});

describe("POST /v1/admin/push/send", () => {
  it("401s with no session and 403s a non-admin, sending nothing", async () => {
    const anon = await adminRoutes.request("/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    expect(anon.status).toBe(401);
    expect((await send(message, asPlayer())).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing confirm", { confirm: undefined }],
    ["wrong confirm", { confirm: "send" }],
    ["no users", { userIds: [] }],
    ["non-uuid user", { userIds: ["nope"] }],
    ["501 users", { userIds: Array.from({ length: 501 }, () => aliceId) }],
    ["blank title", { title: "  " }],
    ["long title", { title: "x".repeat(101) }],
    ["blank body", { body: "" }],
    ["long body", { body: "x".repeat(501) }],
    ["non-highscore url", { url: "https://example.com" }],
  ])("400s %s and sends nothing", async (_label, patch) => {
    const res = await send({ ...message, ...patch });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s objectionable title or body with OBJECTIONABLE_CONTENT", async () => {
    for (const patch of [{ title: "you retard" }, { body: "n1gg3r" }]) {
      const res = await send({ ...message, ...patch });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { details?: { code?: string } };
      expect(body.details?.code).toBe("OBJECTIONABLE_CONTENT");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one message per token, reports per-user results, and prunes dead tokens", async () => {
    const info = vi.spyOn(logger, "info");
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe(STUB_URL);
      const messages = parseMessages(init?.body);
      expect(messages).toEqual([
        {
          to: "ExpoPushToken[alice-1]",
          title: "New game",
          body: "Krillion is on the catalog",
          data: { url: "highscore:///games" },
          sound: "default",
        },
        expect.objectContaining({ to: "ExpoPushToken[alice-2]" }),
        expect.objectContaining({ to: "ExpoPushToken[bob-1]" }),
      ]);
      return tickets([
        { status: "ok", id: "t1" },
        { status: "error", details: { error: "DeviceNotRegistered" } },
        { status: "error", details: { error: "MessageRateExceeded" } },
      ]);
    });

    const res = await send({
      ...message,
      userIds: [aliceId, bobId, noTokenId],
      url: "highscore:///games",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminPushSendResponse;
    expect(body).toMatchObject({ recipients: 2, tokens: 3, sent: 1, failed: 2, pruned: 1 });
    expect(body.perUser).toEqual([
      {
        userId: aliceId,
        displayName: "Alice Anders",
        status: "partial",
        tokens: 2,
        sent: 1,
        failed: 1,
        pruned: 1,
        errors: ["DeviceNotRegistered"],
      },
      {
        userId: bobId,
        displayName: "Bob",
        status: "failed",
        tokens: 1,
        sent: 0,
        failed: 1,
        pruned: 0,
        errors: ["MessageRateExceeded"],
      },
      {
        userId: noTokenId,
        displayName: "No Token",
        status: "no_tokens",
        tokens: 0,
        sent: 0,
        failed: 0,
        pruned: 0,
        errors: [],
      },
    ]);
    expect(
      await rows(`SELECT 1 FROM push_tokens WHERE expo_push_token = 'ExpoPushToken[alice-2]'`),
    ).toHaveLength(0);
    expect(info).toHaveBeenCalledWith(
      "admin_push_sent",
      expect.objectContaining({
        adminUserId: adminId,
        recipientCount: 2,
        sent: 1,
        failed: 2,
        pruned: 1,
        title: "New game",
      }),
    );
    info.mockRestore();
  });

  it("defaults the deep link to highscore:///", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const messages = parseMessages(init?.body);
      expect(messages[0]?.data).toEqual({ url: "highscore:///" });
      return tickets(messages.map(() => ({ status: "ok" })));
    });
    const res = await send({ ...message, userIds: [bobId] });
    expect(res.status).toBe(200);
    expect((await res.json()) as AdminPushSendResponse).toMatchObject({
      sent: 1,
      perUser: [{ userId: bobId, status: "sent" }],
    });
  });

  it("chunks at 100 and isolates a failed chunk as request_failed", async () => {
    for (let i = 0; i < 101; i++) {
      await rows(
        `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone)
         VALUES ($1, $2, 'ios', 'UTC')`,
        [bulkId, `ExpoPushToken[bulk-${String(i).padStart(3, "0")}]`],
      );
    }
    const logError = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const messages = parseMessages(init?.body);
      if (fetchMock.mock.calls.length === 1) {
        expect(messages).toHaveLength(100);
        return tickets(messages.map(() => ({ status: "ok" })));
      }
      expect(messages).toHaveLength(1);
      return new Response("rate limited", { status: 429 });
    });

    const res = await send({ ...message, userIds: [bulkId] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminPushSendResponse;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toMatchObject({ recipients: 1, tokens: 101, sent: 100, failed: 1, pruned: 0 });
    expect(body.perUser).toEqual([
      expect.objectContaining({ status: "partial", errors: ["request_failed"] }),
    ]);
    expect(logError).toHaveBeenCalledWith(
      "expo push chunk failed",
      expect.objectContaining({ chunk_index: 1, token_count: 1 }),
    );
    logError.mockRestore();
  });

  it("an impersonating admin passes the gate and is logged as themselves", async () => {
    const info = vi.spyOn(logger, "info");
    fetchMock.mockImplementation(async () => tickets([{ status: "ok" }]));
    const token = signSession(aliceId, { impersonatorUserId: adminId });
    const res = await send({ ...message, userIds: [bobId] }, headers(token));
    expect(res.status).toBe(200);
    expect(info).toHaveBeenCalledWith(
      "admin_push_sent",
      expect.objectContaining({ adminUserId: adminId }),
    );
    info.mockRestore();
  });
});
