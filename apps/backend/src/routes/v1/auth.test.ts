import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { authRoutes } from "./auth.js";

describe("POST /v1/auth/dev", () => {
  beforeAll(() => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
  });

  afterEach(() => {
    delete process.env.DEV_AUTH_ENABLED;
    resetConfigForTesting();
  });

  it("returns 404 when DEV_AUTH_ENABLED is unset", async () => {
    resetConfigForTesting();
    const res = await authRoutes.request("/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.test" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns 404 when DEV_AUTH_ENABLED=0", async () => {
    process.env.DEV_AUTH_ENABLED = "0";
    resetConfigForTesting();
    const res = await authRoutes.request("/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.test" }),
    });
    expect(res.status).toBe(404);
  });

  it("validates body shape when enabled", async () => {
    process.env.DEV_AUTH_ENABLED = "1";
    resetConfigForTesting();
    const res = await authRoutes.request("/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });
});
