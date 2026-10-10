import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "./config.js";
import { notifyDiscord, withClientSuffix } from "./discord.js";
import { runWithRequestClientContext } from "./requestContext.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetConfigForTesting();
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("notifyDiscord", () => {
  it("no-ops when webhook URL is unset", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "";
    const fetcher = vi.fn();
    await notifyDiscord("hello", { fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("POSTs the content payload to the webhook URL", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await notifyDiscord("hello world", { fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://discord.example/webhooks/1/abc");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ content: "hello world" });
  });

  it("retries once on a 429 rate-limit, then gives up", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    await expect(
      notifyDiscord("hello", { fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a connect failure (never sent) and succeeds on the second attempt", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }),
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await notifyDiscord("hello", { fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a timeout — the first POST may have landed (duplicate ping)", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetcher = vi.fn().mockRejectedValueOnce(timeout);
    await notifyDiscord("hello", { fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry a mid-response reset or a 504", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const reset = vi.fn().mockRejectedValueOnce(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("x"), { code: "ECONNRESET" }),
      }),
    );
    await notifyDiscord("hello", { fetcher: reset as unknown as typeof fetch });
    expect(reset).toHaveBeenCalledTimes(1);
    const gateway = vi.fn().mockResolvedValueOnce(new Response("", { status: 504 }));
    await notifyDiscord("hello", { fetcher: gateway as unknown as typeof fetch });
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("does not retry a non-retryable 4xx (e.g. deleted webhook)", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("gone", { status: 404 }));
    await expect(
      notifyDiscord("hello", { fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("swallows thrown errors (timeouts, network failures)", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      notifyDiscord("hello", { fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toBeUndefined();
  });

  it("appends the requesting client when a request context is active", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await runWithRequestClientContext(
      { client: "highscore", platform: "ios", appVersion: "1.4.0" },
      () =>
        notifyDiscord("👋 new signup — Ada via apple", {
          fetcher: fetcher as unknown as typeof fetch,
        }),
    );
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({
      content: "👋 new signup — Ada via apple · HighScore · iOS 1.4.0",
    });
  });

  it("omits the client suffix when asked, or when no request context exists", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await runWithRequestClientContext(
      { client: "workshop", platform: "web", appVersion: "1.0.0" },
      () => notifyDiscord("x", { fetcher: fetcher as unknown as typeof fetch, withClient: false }),
    );
    await notifyDiscord("y", { fetcher: fetcher as unknown as typeof fetch });
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({ content: "x" });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body as string)).toEqual({ content: "y" });
  });
});

describe("withClientSuffix", () => {
  it("joins with a middle dot and passes through when the client is unknown", () => {
    expect(withClientSuffix("hello", "Workshop · iOS 1.0.0")).toBe("hello · Workshop · iOS 1.0.0");
    expect(withClientSuffix("hello", null)).toBe("hello");
  });
});
