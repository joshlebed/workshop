import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import type { DiscordBotConfig } from "../lib/discordBot.js";
import { runDiscordHealthJob } from "./discordHealth.js";

const URL_OK = "https://api.test/discord/interactions";
const config: DiscordBotConfig = {
  botToken: "t",
  applicationId: "1",
  publicKey: "0".repeat(64),
  guildId: "g",
  channelId: "c",
  allowedUserIds: ["u"],
  niteshiftWebhookUrl: "https://niteshift.test/hook",
  niteshiftWebhookSecret: "s",
  interactionsUrl: URL_OK,
};

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
});

function discord(over: { app?: unknown; appStatus?: number; commands?: unknown; read?: number }) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("https://discord.com/api/v10", "");
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/applications/@me" && init?.method === "PATCH") return Response.json({});
    if (path === "/applications/@me")
      return Response.json(over.app ?? { flags: 1 << 19, interactions_endpoint_url: URL_OK }, {
        status: over.appStatus ?? 200,
      });
    if (path.endsWith("/commands"))
      return Response.json(over.commands ?? [{ name: "niteshift" }, { name: "Send to Niteshift" }]);
    return new Response("[]", { status: over.read ?? 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("runDiscordHealthJob", () => {
  it("says nothing when healthy", async () => {
    const notify = vi.fn();
    const { fetcher } = discord({});
    expect(await runDiscordHealthJob({ config, fetcher, notify })).toEqual({ ok: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("re-sets a blanked endpoint URL and reports the repair", async () => {
    const notify = vi.fn();
    const { fetcher, calls } = discord({
      app: { flags: 1 << 18, interactions_endpoint_url: null },
    });
    expect(await runDiscordHealthJob({ config, fetcher, notify })).toEqual({ ok: true });
    expect(calls).toContain("PATCH /applications/@me");
    expect(notify.mock.calls[0]?.[0]).toContain(
      "🔧 Interactions Endpoint URL was blank; re-set it",
    );
  });

  it("reports a revoked token, intent off, missing commands, lost channel", async () => {
    const notify = vi.fn();
    await runDiscordHealthJob({ config, fetcher: discord({ appStatus: 401 }).fetcher, notify });
    expect(notify.mock.calls[0]?.[0]).toContain("bot token rejected (401)");

    notify.mockClear();
    const { fetcher } = discord({
      app: { flags: 0, interactions_endpoint_url: URL_OK },
      commands: [{ name: "niteshift" }],
      read: 403,
    });
    expect(await runDiscordHealthJob({ config, fetcher, notify })).toEqual({ ok: false });
    const text = notify.mock.calls[0]?.[0] as string;
    expect(text).toContain("Message Content Intent is off");
    expect(text).toContain("commands not registered: Send to Niteshift");
    expect(text).toContain("can't read #workshop-admin (403)");
  });

  it("flags missing config only when one is expected", async () => {
    const notify = vi.fn();
    expect(await runDiscordHealthJob({ config: null, configured: false, notify })).toEqual({
      ok: true,
    });
    expect(notify).not.toHaveBeenCalled();
    expect(await runDiscordHealthJob({ config: null, configured: true, notify })).toEqual({
      ok: false,
    });
    expect(notify).toHaveBeenCalledOnce();
  });
});
