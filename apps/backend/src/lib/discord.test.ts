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
    await notifyDiscord("hello", fetcher as unknown as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("POSTs the content payload to the webhook URL", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    await notifyDiscord("hello world", fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://discord.example/webhooks/1/abc");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ content: "hello world" });
  });

  it("swallows non-2xx responses", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 429 }));
    await expect(
      notifyDiscord("hello", fetcher as unknown as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it("swallows thrown errors (timeouts, network failures)", async () => {
    process.env.DISCORD_NOTIFY_WEBHOOK_URL = "https://discord.example/webhooks/1/abc";
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(
      notifyDiscord("hello", fetcher as unknown as typeof fetch),
    ).resolves.toBeUndefined();
  });
});
