import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "./config.js";
import { notifyDiscord } from "./discord.js";

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

  it("retries after a transient throw and succeeds on the second attempt", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await notifyDiscord("hello", { fetcher: fetcher as unknown as typeof fetch });
    expect(fetcher).toHaveBeenCalledTimes(2);
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
});
