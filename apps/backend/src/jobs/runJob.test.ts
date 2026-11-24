import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import { runJob } from "./runJob.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
});

afterEach(() => vi.restoreAllMocks());

describe("runJob", () => {
  it("returns the job's result", async () => {
    expect(await runJob("x", async () => ({ sent: 2 }))).toEqual({ sent: 2 });
  });

  it("logs the line the alarm counts and does not rethrow", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runJob("request-rollups", async () => {
      throw new Error("boom");
    });
    expect(out).toEqual({ failed: true });
    const entry: unknown = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({ level: "error", msg: "job failed", job: "request-rollups" });
  });
});
