import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import type { DiscordBotConfig } from "../lib/discordBot.js";
import { mergedDiscordPrs, runDiscordMergedJob } from "./discordMerged.js";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const MSG = "1569451762749014130";
const config: DiscordBotConfig = {
  botToken: "t",
  applicationId: "1",
  publicKey: "0".repeat(64),
  guildId: "g",
  channelId: "c",
  allowedUserIds: ["u"],
  niteshiftWebhookUrl: "https://niteshift.test/hook",
  niteshiftWebhookSecret: "s",
};
const pr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Fix it",
  html_url: "https://github.com/joshlebed/workshop/pull/7",
  merged_at: "2026-11-09T11:00:00Z",
  body: `Does a thing.\n\nDiscord-Message: ${MSG}\n`,
  ...over,
});

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
});

describe("mergedDiscordPrs", () => {
  it("keeps recently merged PRs that carry the marker line", () => {
    const prs = [
      pr(),
      pr({ number: 8, merged_at: null }),
      pr({ number: 9, merged_at: "2026-11-01T00:00:00Z" }),
      pr({ number: 10, body: "mentions Discord-Message: 123 inline" }),
      pr({ number: 11, body: null }),
    ];
    expect(mergedDiscordPrs(prs, NOW).map((x) => [x.pr.number, x.messageId])).toEqual([[7, MSG]]);
  });
});

describe("runDiscordMergedJob", () => {
  function fake(reactions: unknown[] = []) {
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace("https://discord.com/api/v10", "")}`);
      if (url.startsWith("https://api.github.com")) return Response.json([pr()]);
      if (url.endsWith(`/messages/${MSG}`))
        return Response.json({ reactions, thread: { id: MSG } });
      return Response.json({});
    }) as unknown as typeof fetch;
    return { fetcher, calls };
  }

  it("reacts ✅ and posts in the task thread", async () => {
    const { fetcher, calls } = fake();
    expect(await runDiscordMergedJob({ config, fetcher, now: NOW })).toEqual({ marked: 1 });
    expect(calls.slice(1)).toEqual([
      `GET /channels/c/messages/${MSG}`,
      `PUT /channels/c/messages/${MSG}/reactions/%E2%9C%85/@me`,
      `POST /channels/${MSG}/messages`,
    ]);
  });

  it("skips a message the bot already marked", async () => {
    const { fetcher } = fake([{ me: true, emoji: { name: "✅" } }]);
    expect(await runDiscordMergedJob({ config, fetcher, now: NOW })).toEqual({ marked: 0 });
  });
});
