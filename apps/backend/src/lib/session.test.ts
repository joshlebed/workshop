import { beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "./config.js";
import { signSession, verifySession } from "./session.js";

function setEnv() {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.SES_FROM_ADDRESS = "test@example.com";
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
});
