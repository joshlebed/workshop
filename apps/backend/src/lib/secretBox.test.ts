import { beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "./config.js";
import { open, PROVIDER_REFRESH_TOKEN_PURPOSE, seal } from "./secretBox.js";

function useSecret(secret: string) {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = secret;
  resetConfigForTesting();
}

describe("secretBox", () => {
  beforeEach(() => useSecret("a".repeat(32)));

  it("round-trips a value for the same purpose", () => {
    const sealed = seal(PROVIDER_REFRESH_TOKEN_PURPOSE, "apple-refresh-token");
    expect(sealed).not.toContain("apple-refresh-token");
    expect(open(PROVIDER_REFRESH_TOKEN_PURPOSE, sealed)).toBe("apple-refresh-token");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = seal("p", "same");
    const b = seal("p", "same");
    expect(a).not.toBe(b);
    expect(open("p", a)).toBe("same");
    expect(open("p", b)).toBe("same");
  });

  it("refuses to open under a different purpose", () => {
    expect(open("other", seal("p", "secret"))).toBeNull();
  });

  it("refuses to open a tampered ciphertext", () => {
    const sealed = seal("p", "secret");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(open("p", parts.join("."))).toBeNull();
  });

  it("refuses to open after the session secret rotates", () => {
    const sealed = seal("p", "secret");
    useSecret("b".repeat(32));
    expect(open("p", sealed)).toBeNull();
  });

  it("treats null / empty / malformed envelopes as absent", () => {
    expect(open("p", null)).toBeNull();
    expect(open("p", "")).toBeNull();
    expect(open("p", "not-an-envelope")).toBeNull();
    expect(open("p", "v9.a.b.c")).toBeNull();
  });
});
