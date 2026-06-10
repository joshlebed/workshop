import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { authRoutes, buildSignInNotification } from "./auth.js";

describe("buildSignInNotification", () => {
  const user = { id: "u_1", email: "a@b.test", displayName: "Ada" };

  it("uses the celebratory signup copy for a genuinely new user", () => {
    expect(buildSignInNotification(user, "apple", true)).toEqual({
      content: ":wave: new signup — Ada via apple",
      kind: "signup",
    });
  });

  it("uses the quieter signed-in copy for a returning user", () => {
    expect(buildSignInNotification(user, "google", false)).toEqual({
      content: ":bust_in_silhouette: signed in — Ada via google",
      kind: "signin",
    });
  });

  it("falls back display name → email → id for the label", () => {
    expect(buildSignInNotification({ ...user, displayName: null }, "apple", false).content).toBe(
      ":bust_in_silhouette: signed in — a@b.test via apple",
    );
    expect(
      buildSignInNotification({ id: "u_2", email: null, displayName: null }, "apple", true).content,
    ).toBe(":wave: new signup — u_2 via apple");
  });
});

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
