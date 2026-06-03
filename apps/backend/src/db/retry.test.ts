import { describe, expect, it, vi } from "vitest";
import { isTransientDbConnectError, withDbRetry } from "./retry.js";

// logger.warn calls getConfig() for level filtering; stub it so this unit test
// stays isolated from config/env.
vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const connErr = (code: string) => Object.assign(new Error(`boom: ${code}`), { code });

// Fast, deterministic-ish backoff for tests.
const fast = { baseDelayMs: 1, maxDelayMs: 1, attemptCostMs: 0 } as const;

describe("isTransientDbConnectError", () => {
  it("matches transient connect codes on code or errno", () => {
    expect(isTransientDbConnectError(connErr("CONNECT_TIMEOUT"))).toBe(true);
    expect(isTransientDbConnectError({ errno: "ECONNREFUSED" })).toBe(true);
    expect(isTransientDbConnectError(connErr("ECONNRESET"))).toBe(true);
  });

  it("walks the cause chain", () => {
    const wrapped = Object.assign(new Error("drizzle query failed"), {
      cause: Object.assign(new Error("inner"), { cause: connErr("CONNECT_TIMEOUT") }),
    });
    expect(isTransientDbConnectError(wrapped)).toBe(true);
  });

  it("rejects non-connection and malformed errors", () => {
    expect(isTransientDbConnectError(connErr("23505"))).toBe(false); // unique violation
    expect(isTransientDbConnectError(new Error("plain"))).toBe(false);
    expect(isTransientDbConnectError("nope")).toBe(false);
    expect(isTransientDbConnectError(null)).toBe(false);
  });

  it("does not loop on a self-referential cause", () => {
    const e: { code: string; cause?: unknown } = { code: "WHATEVER" };
    e.cause = e;
    expect(isTransientDbConnectError(e)).toBe(false);
  });
});

describe("withDbRetry", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withDbRetry(fn, fast)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient connect error, then succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(connErr("CONNECT_TIMEOUT"))
      .mockResolvedValueOnce("recovered");
    await expect(withDbRetry(fn, fast)).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("re-throws non-transient errors immediately", async () => {
    const fn = vi.fn(async () => {
      throw connErr("23505");
    });
    await expect(withDbRetry(fn, fast)).rejects.toMatchObject({ code: "23505" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts on a persistent transient error", async () => {
    const fn = vi.fn(async () => {
      throw connErr("CONNECT_TIMEOUT");
    });
    await expect(withDbRetry(fn, { ...fast, maxAttempts: 3 })).rejects.toMatchObject({
      code: "CONNECT_TIMEOUT",
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops early when the next attempt would exceed the time budget", async () => {
    const fn = vi.fn(async () => {
      throw connErr("CONNECT_TIMEOUT");
    });
    // attemptCostMs (5s) alone already exceeds the 1s budget, so no retry fires.
    await expect(
      withDbRetry(fn, { maxAttempts: 5, baseDelayMs: 1, attemptCostMs: 5000, budgetMs: 1000 }),
    ).rejects.toMatchObject({ code: "CONNECT_TIMEOUT" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
