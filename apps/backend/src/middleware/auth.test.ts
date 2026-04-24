import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import { ok } from "../lib/response.js";
import { signSession } from "../lib/session.js";
import { requireAuth } from "./auth.js";

function buildAppForTest() {
  const app = new Hono();
  app.use("/protected", requireAuth);
  app.get("/protected", (c) => ok(c, { userId: c.get("userId") }));
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
  });
});
