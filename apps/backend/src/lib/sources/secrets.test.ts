import { beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "../config.js";
import {
  __resetKeyCacheForTesting,
  openSecrets,
  SecretEnvelopeError,
  sealSecrets,
} from "./secrets.js";

beforeEach(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "a".repeat(32);
  resetConfigForTesting();
  __resetKeyCacheForTesting();
});

describe("source secrets envelope (AES-256-GCM)", () => {
  it("round-trips a secrets payload", () => {
    const sealed = sealSecrets({ refreshToken: "abc", scope: "read" });
    expect(sealed.v).toBe(1);
    expect(typeof sealed.iv).toBe("string");
    expect(typeof sealed.ct).toBe("string");
    const opened = openSecrets(sealed);
    expect(opened).toEqual({ refreshToken: "abc", scope: "read" });
  });

  it("two consecutive seals of the same payload produce different ciphertexts (random IV)", () => {
    const payload = { token: "same" };
    const a = sealSecrets(payload);
    const b = sealSecrets(payload);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(openSecrets(a)).toEqual(payload);
    expect(openSecrets(b)).toEqual(payload);
  });

  it("openSecrets throws on tampered ciphertext", () => {
    const sealed = sealSecrets({ token: "x" });
    const tampered = {
      ...sealed,
      ct: sealed.ct.slice(0, -2) + (sealed.ct.endsWith("A") ? "B" : "A"),
    };
    expect(() => openSecrets(tampered)).toThrow(SecretEnvelopeError);
  });

  it("openSecrets throws on a different SESSION_SECRET", () => {
    const sealed = sealSecrets({ token: "x" });

    process.env.SESSION_SECRET = "b".repeat(32);
    resetConfigForTesting();
    __resetKeyCacheForTesting();

    expect(() => openSecrets(sealed)).toThrow(SecretEnvelopeError);
  });

  it("openSecrets throws on a malformed envelope", () => {
    expect(() => openSecrets({ v: 1, iv: "x", ct: "y" })).toThrow(SecretEnvelopeError);
    expect(() => openSecrets({})).toThrow(SecretEnvelopeError);
    expect(() => openSecrets(null)).toThrow(SecretEnvelopeError);
  });

  it("openSecrets throws on an unsupported envelope version", () => {
    const sealed = sealSecrets({ token: "x" });
    expect(() => openSecrets({ ...sealed, v: 2 })).toThrow(SecretEnvelopeError);
  });

  it("handles nested + non-string values", () => {
    const payload = {
      refreshToken: "abc",
      expiresAt: 1700000000,
      scopes: ["read", "write"],
      profile: { id: 42, locale: "en" },
    };
    const sealed = sealSecrets(payload);
    expect(openSecrets(sealed)).toEqual(payload);
  });
});
