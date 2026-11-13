import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import { ok } from "../lib/response.js";
import { signSession } from "../lib/session.js";
import { requireAuth } from "./auth.js";

// `checkSession` (what requireAuth calls) answers through the
// `isSessionRevoked` mock, so the revocation tests below keep asserting on one
// function; `nameless` is the set of user ids with no display name.
const nameless = vi.hoisted(() => new Set<string>());
vi.mock("../lib/sessionRevocation.js", () => {
  const isSessionRevoked = vi.fn(async (..._args: unknown[]) => false);
  return {
    isSessionRevoked,
    checkSession: vi.fn(async (userId: string, ...rest: unknown[]) => {
      const revoked = await isSessionRevoked(userId, ...rest);
      return { revoked, displayNameMissing: !revoked && nameless.has(userId) };
    }),
  };
});

// Imported after vi.mock so the mocked module is used.
const { isSessionRevoked } = await import("../lib/sessionRevocation.js");

function buildAppForTest() {
  const app = new Hono();
  app.use("/protected", requireAuth);
  app.get("/protected", (c) =>
    ok(c, {
      userId: c.get("userId"),
      impersonatorUserId: c.get("impersonatorUserId"),
      sessionId: c.get("sessionId"),
    }),
  );
  return app;
}

describe("requireAuth middleware", () => {
  beforeAll(() => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    resetConfigForTesting();
  });

  afterEach(() => {
    resetConfigForTesting();
    vi.mocked(isSessionRevoked).mockReset();
    vi.mocked(isSessionRevoked).mockResolvedValue(false);
  });

  it("returns the v1 envelope when the Authorization header is missing", async () => {
    const res = await buildAppForTest().request("/protected");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "missing bearer token",
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a non-bearer authorization scheme", async () => {
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: "Basic abc" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects an empty bearer token", async () => {
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unsigned/garbage token", async () => {
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: "Bearer not.a.real.token" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: "UNAUTHORIZED",
      error: "invalid or expired session",
    });
  });

  it("accepts a freshly-signed session token and stores userId on the context", async () => {
    const token = signSession("user-abc");
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-abc" });
    expect(isSessionRevoked).toHaveBeenCalledWith("user-abc", expect.any(Number));
  });

  it("accepts an impersonated token and checks both users for revocation", async () => {
    const token = signSession("target-user", { impersonatorUserId: "admin-user" });
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "target-user",
      impersonatorUserId: "admin-user",
    });
    expect(isSessionRevoked).toHaveBeenCalledWith("target-user", expect.any(Number));
    expect(isSessionRevoked).toHaveBeenCalledWith("admin-user", expect.any(Number));
  });

  it("checks a managed session row and exposes its id to the route", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000123";
    const token = signSession("user-abc", { sessionId });
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-abc", sessionId });
    expect(isSessionRevoked).toHaveBeenCalledWith("user-abc", expect.any(Number), {
      sessionId,
      subjectUserId: "user-abc",
    });
  });

  it("forwards the access token's refresh version to the managed session check", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000124";
    const token = signSession("user-abc", { sessionId, sessionVersion: 4 });
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(isSessionRevoked).toHaveBeenCalledWith("user-abc", expect.any(Number), {
      sessionId,
      subjectUserId: "user-abc",
      sessionVersion: 4,
    });
  });

  it("rejects an impersonated token when the admin session is revoked", async () => {
    vi.mocked(isSessionRevoked).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const token = signSession("target-user", { impersonatorUserId: "admin-user" });
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token that the revocation check flags as revoked", async () => {
    vi.mocked(isSessionRevoked).mockResolvedValueOnce(true);
    const token = signSession("user-abc");
    const res = await buildAppForTest().request("/protected", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      code: "UNAUTHORIZED",
      error: "invalid or expired session",
    });
  });
});

describe("requireAuth display-name lock", () => {
  beforeAll(() => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    resetConfigForTesting();
  });

  afterEach(() => {
    nameless.clear();
  });

  function lockApp() {
    const app = new Hono();
    app.use("*", requireAuth);
    app.all("*", (c) => ok(c, { userId: c.get("userId") }));
    return app;
  }

  async function hit(method: string, path: string, token: string) {
    return lockApp().request(path, { method, headers: { Authorization: `Bearer ${token}` } });
  }

  it("refuses a nameless user outside the allow-list with 403 DISPLAY_NAME_REQUIRED", async () => {
    nameless.add("user-new");
    const token = signSession("user-new");
    for (const [method, path] of <const>[
      ["GET", "/v1/lists"],
      ["PUT", "/v1/games/g1/scores"],
      ["PATCH", "/v1/users/me/flags"],
      ["POST", "/v1/auth/impersonate"],
    ]) {
      const res = await hit(method, path, token);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "choose a display name first",
        code: "FORBIDDEN",
        details: { code: "DISPLAY_NAME_REQUIRED" },
      });
    }
  });

  it("allows a nameless user on every allow-listed route (trailing slash too)", async () => {
    nameless.add("user-new");
    const token = signSession("user-new");
    for (const [method, path] of <const>[
      ["GET", "/v1/auth/me"],
      ["POST", "/v1/auth/session"],
      ["POST", "/v1/auth/signout"],
      ["PATCH", "/v1/users/me"],
      ["PATCH", "/v1/users/me/"],
      ["DELETE", "/v1/users/me"],
      ["DELETE", "/v1/users/me/sessions"],
      ["DELETE", "/v1/me/push-token"],
    ]) {
      expect({ method, path, status: (await hit(method, path, token)).status }).toEqual({
        method,
        path,
        status: 200,
      });
    }
  });

  it("locks on the impersonated subject's name, not the admin's", async () => {
    nameless.add("target-user");
    const token = signSession("target-user", { impersonatorUserId: "admin-user" });
    expect((await hit("GET", "/v1/lists", token)).status).toBe(403);
    expect((await hit("POST", "/v1/auth/impersonation/stop", token)).status).toBe(200);

    nameless.clear();
    nameless.add("admin-user");
    expect((await hit("GET", "/v1/lists", token)).status).toBe(200);
  });

  it("reports revocation (401) before the lock", async () => {
    nameless.add("user-new");
    vi.mocked(isSessionRevoked).mockResolvedValueOnce(true);
    expect((await hit("GET", "/v1/lists", signSession("user-new"))).status).toBe(401);
  });
});
