import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import { requestLog } from "./request-log.js";

function buildAppForTest() {
  const app = new Hono();
  app.use("*", requestLog);
  app.get("/ping", (c) => c.json({ ok: true }));
  app.get("/whoami", (c) => {
    c.set("userId", "user-xyz");
    return c.json({ ok: true });
  });
  app.get("/boom", () => {
    throw new Error("kaboom");
  });
  app.onError((_e, c) => c.json({ error: "INTERNAL" }, 500));
  return app;
}

function lastInfoEntry(spy: ReturnType<typeof vi.spyOn>) {
  const lastCall = spy.mock.calls.at(-1);
  if (!lastCall) throw new Error("no console.log entries");
  const [line] = lastCall;
  return JSON.parse(String(line)) as Record<string, unknown>;
}

describe("requestLog middleware", () => {
  beforeAll(() => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    process.env.LOG_LEVEL = "info";
    resetConfigForTesting();
  });

  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    resetConfigForTesting();
  });

  it("emits a structured request line with method/path/status/duration", async () => {
    const res = await buildAppForTest().request("/ping");
    expect(res.status).toBe(200);
    const entry = lastInfoEntry(logSpy);
    expect(entry).toMatchObject({
      kind: "request",
      msg: "request",
      method: "GET",
      path: "/ping",
      status: 200,
      platform: "unknown",
      user_id: null,
    });
    expect(typeof entry.duration_ms).toBe("number");
    expect(typeof entry.request_id).toBe("string");
  });

  it("captures the userId set by downstream handlers", async () => {
    await buildAppForTest().request("/whoami");
    expect(lastInfoEntry(logSpy)).toMatchObject({ user_id: "user-xyz", path: "/whoami" });
  });

  it("reads the explicit X-Workshop-Platform and version headers", async () => {
    await buildAppForTest().request("/ping", {
      headers: {
        "X-Workshop-Platform": "ios",
        "X-Workshop-App-Version": "0.3.0",
        "User-Agent": "anything",
      },
    });
    expect(lastInfoEntry(logSpy)).toMatchObject({
      platform: "ios",
      app_version: "0.3.0",
    });
  });

  it("falls back to user-agent detection when no platform header is set", async () => {
    await buildAppForTest().request("/ping", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    expect(lastInfoEntry(logSpy)).toMatchObject({ platform: "web" });
  });

  it("logs even when the handler throws and onError builds the response", async () => {
    const res = await buildAppForTest().request("/boom");
    expect(res.status).toBe(500);
    expect(lastInfoEntry(logSpy)).toMatchObject({
      kind: "request",
      path: "/boom",
      status: 500,
    });
  });
});
