import { beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "./config.js";
import { signSession, verifySession } from "./session.js";

function setEnv() {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.AWS_REGION = "us-east-1";
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
}

describe("session tokens", () => {
  beforeEach(setEnv);

  it("signs and verifies a valid token", () => {
    const token = signSession("user-123");
    const payload = verifySession(token);
    expect(payload?.userId).toBe("user-123");
  });

  it("rejects a tampered token", () => {
    const token = signSession("user-123");
    const parts = token.split(".");
    const tampered = `${parts[0]}.AAAAAAA`;
    expect(verifySession(tampered)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifySession("nope")).toBeNull();
    expect(verifySession("")).toBeNull();
  });

  it("includes iat on freshly-signed tokens", () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = verifySession(signSession("user-123"));
    const after = Math.floor(Date.now() / 1000);
    expect(payload?.iat).toBeDefined();
    expect(payload?.iat).toBeGreaterThanOrEqual(before);
    expect(payload?.iat).toBeLessThanOrEqual(after);
  });

  it("can include the impersonating admin on impersonated sessions", () => {
    const payload = verifySession(signSession("target-user", { impersonatorUserId: "admin-user" }));
    expect(payload).toMatchObject({
      userId: "target-user",
      impersonatorUserId: "admin-user",
    });
  });
});
