// The display-name lock end to end: the real app, the real `requireAuth` and
// session check, PGlite with the real migrations. A nameless account is
// refused everywhere except the allow-list, and unlocked by the very next
// request after it sets a name. An admin impersonating a nameless account is
// locked the same way and can still stop.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// test-setup mocks the session check for route tests; this one needs the real one.
vi.unmock("./sessionRevocation.js");

let testDb: ReturnType<typeof drizzle>;
vi.mock("../db/client.js", () => ({ getDb: () => testDb }));

import { buildApp } from "../app.js";
import { resetConfigForTesting } from "./config.js";

const app = buildApp();

type Json = Record<string, unknown>;

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json | null };
}

async function devSignIn(email: string, displayName?: string) {
  const res = await call("POST", "/v1/auth/dev", null, { email, displayName });
  expect(res.status).toBe(200);
  return res.body as { token: string; user: { id: string }; needsDisplayName: boolean };
}

const LOCKED = { code: "FORBIDDEN", details: { code: "DISPLAY_NAME_REQUIRED" } };

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.DEV_AUTH_ENABLED = "1";
  resetConfigForTesting();
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
});

afterAll(() => {
  delete process.env.DEV_AUTH_ENABLED;
  resetConfigForTesting();
});

describe("display-name lock", () => {
  it("refuses a nameless account on reads and writes, then unlocks it once a name is set", async () => {
    const { token, needsDisplayName } = await devSignIn("nameless@lock.test");
    expect(needsDisplayName).toBe(true);

    // A representative read and write in each app.
    for (const [method, path, body] of [
      ["GET", "/v1/lists", undefined],
      ["GET", "/v1/games", undefined],
      ["POST", "/v1/lists", { name: "Mine", emoji: "📝", color: "amber" }],
      ["POST", "/v1/friends/invite", undefined],
      ["GET", "/v1/users/me/flags", undefined],
      ["POST", "/v1/me/push-token", { token: "ExponentPushToken[x]", timezone: "UTC" }],
    ] as const) {
      const res = await call(method, path, token, body);
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
      expect(res.body).toMatchObject(LOCKED);
    }

    // Who am I: allowed, and says there is no name — what routes any client to the name screen.
    const me = await call("GET", "/v1/auth/me", token);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ user: { displayName: null } });

    // Setting the name is allowed and unlocks the very next request.
    const patch = await call("PATCH", "/v1/users/me", token, { displayName: "  Nora  " });
    expect(patch.status).toBe(200);
    expect(patch.body).toMatchObject({ user: { displayName: "Nora" } });
    expect((await call("GET", "/v1/lists", token)).status).toBe(200);
    expect((await call("GET", "/v1/users/me/flags", token)).status).toBe(200);
  });

  it("still lets a nameless account leave: upgrade, sign out, sign out everywhere, unregister push, delete", async () => {
    const a = await devSignIn("leaver@lock.test");
    const session = await call("POST", "/v1/auth/session", a.token);
    expect(session.status).toBe(200);
    expect(session.body?.needsDisplayName).toBe(true);
    expect(
      (await call("DELETE", "/v1/me/push-token", a.token, { token: "ExponentPushToken[x]" }))
        .status,
    ).not.toBe(403);
    expect((await call("POST", "/v1/auth/signout", a.token)).status).toBe(200);
    expect((await call("DELETE", "/v1/users/me/sessions", a.token)).status).not.toBe(403);

    const b = await devSignIn("deleter@lock.test");
    const del = await call("DELETE", "/v1/users/me", b.token);
    expect(del.status).toBe(200);
  });

  it("answers a bad name on the allow-listed PATCH with the usual 400, not the lock", async () => {
    const { token } = await devSignIn("bad-name@lock.test");
    const res = await call("PATCH", "/v1/users/me", token, { displayName: "   " });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION" });
  });

  it("locks an admin impersonating a nameless account, and lets the admin stop", async () => {
    const admin = await devSignIn("joshlebed@gmail.com", "Josh");
    const target = await devSignIn("target@lock.test");

    const started = await call("POST", "/v1/auth/impersonate", admin.token, {
      target: target.user.id,
    });
    expect(started.status).toBe(200);
    const impersonated = (started.body as { token: string }).token;

    const lists = await call("GET", "/v1/lists", impersonated);
    expect(lists.status).toBe(403);
    expect(lists.body).toMatchObject(LOCKED);
    expect((await call("GET", "/v1/auth/me", impersonated)).status).toBe(200);

    const stopped = await call("POST", "/v1/auth/impersonation/stop", impersonated);
    expect(stopped.status).toBe(200);
    const back = (stopped.body as { token: string }).token;
    expect((await call("GET", "/v1/lists", back)).status).toBe(200);
  });

  it("leaves named accounts alone", async () => {
    const { token } = await devSignIn("named@lock.test", "Named");
    expect((await call("GET", "/v1/lists", token)).status).toBe(200);
  });
});
