import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { __testing, consume, rateLimit } from "./rate-limit.js";

const { windowStart } = __testing;

describe("rate-limit", () => {
  it("windowStart aligns to the start of the bucket", () => {
    const t = new Date("2026-04-24T12:34:56.789Z");
    const w = windowStart(t, 60);
    expect(w.toISOString()).toBe("2026-04-24T12:34:00.000Z");
  });

  it("consume increments and returns the post-increment count", async () => {
    let calls = 0;
    const fakeDb = {
      execute: vi.fn(async () => {
        calls += 1;
        return [{ count: calls }];
      }),
    };
    const start = new Date("2026-04-24T00:00:00Z");
    expect(await consume(fakeDb, "k", start)).toBe(1);
    expect(await consume(fakeDb, "k", start)).toBe(2);
    expect(fakeDb.execute).toHaveBeenCalledTimes(2);
  });

  it("consume tolerates the postgres-js {rows: []} shape", async () => {
    const fakeDb = {
      execute: vi.fn(async () => ({ rows: [{ count: 7 }] })),
    };
    expect(await consume(fakeDb, "k", new Date())).toBe(7);
  });

  it("middleware skips when key returns null", async () => {
    const app = new Hono();
    const consumed = vi.fn();
    app.use(
      "/x",
      rateLimit({
        family: "test",
        limit: 1,
        windowSec: 60,
        key: () => {
          consumed();
          return null;
        },
      }),
    );
    app.get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(200);
    expect(consumed).toHaveBeenCalled();
  });
});
