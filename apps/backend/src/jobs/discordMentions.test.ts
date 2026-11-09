import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import type { DiscordBotConfig, DiscordMessage } from "../lib/discordBot.js";
import { promptFromMention } from "../lib/discordBot.js";
import { pendingMentions, runDiscordMentionsJob } from "./discordMentions.js";

const BOT = "999";
const OPERATOR = "111";
const config: DiscordBotConfig = {
  botToken: "t",
  applicationId: BOT,
  publicKey: "0".repeat(64),
  guildId: "g",
  channelId: "c",
  allowedUserIds: [OPERATOR],
  niteshiftWebhookUrl: "https://niteshift.test/hook",
  niteshiftWebhookSecret: "s",
};

// Snowflake for a given ms timestamp.
const idAt = (ms: number, seq = 0) =>
  ((BigInt(ms - 1420070400000) << 22n) + BigInt(seq)).toString();
const NOW = Date.UTC(2026, 10, 6, 12);

function msg(
  over: Partial<DiscordMessage> & { ageMs?: number; seq?: number } = {},
): DiscordMessage {
  const { ageMs = 60_000, seq = 0, ...rest } = over;
  return {
    id: idAt(NOW - ageMs, seq),
    content: `<@${BOT}> fix the share sheet`,
    author: { id: OPERATOR, username: "josh" },
    mentions: [{ id: BOT }],
    mention_roles: [],
    ...rest,
  };
}

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
});

describe("pendingMentions", () => {
  it("keeps fresh, unhandled operator mentions, oldest first", () => {
    const newer = msg({ ageMs: 1000, seq: 1 });
    const older = msg({ ageMs: 5000, seq: 2 });
    expect(pendingMentions([newer, older], config, NOW).map((m) => m.id)).toEqual([
      older.id,
      newer.id,
    ]);
  });

  it("skips handled, stale, unmentioned, bot and non-operator messages", () => {
    const skipped = [
      msg({ reactions: [{ me: true, emoji: { name: "🌒" } }] }),
      msg({ ageMs: 11 * 60_000 }),
      msg({ mentions: [] }),
      msg({ author: { id: BOT, username: "bot", bot: true } }),
      msg({ author: { id: "666", username: "stranger" } }),
    ];
    expect(pendingMentions(skipped, config, NOW)).toEqual([]);
  });

  it("does not treat someone else's 🌒 as handled", () => {
    expect(
      pendingMentions([msg({ reactions: [{ me: false, emoji: { name: "🌒" } }] })], config, NOW),
    ).toHaveLength(1);
  });
});

describe("triggers", () => {
  const roleConfig = { ...config, botRoleId: "777" };
  it("accepts a role mention and a text /niteshift", () => {
    const role = msg({ content: "<@&777> do it", mentions: [], mention_roles: ["777"] });
    const text = msg({ content: "/niteshift fix it", mentions: [], seq: 5 });
    expect(pendingMentions([role, text], roleConfig, NOW)).toHaveLength(2);
    expect(promptFromMention(role, roleConfig)).toBe("do it");
    expect(promptFromMention(text, roleConfig)).toBe("fix it");
  });
  it("ignores /niteshift mid-sentence and other roles", () => {
    const mid = msg({ content: "try /niteshift later", mentions: [] });
    const other = msg({ content: "<@&888>", mentions: [], mention_roles: ["888"] });
    expect(pendingMentions([mid, other], roleConfig, NOW)).toEqual([]);
  });
});

describe("promptFromMention", () => {
  it("strips the mention and carries the replied-to message", () => {
    const prompt = promptFromMention(
      msg({
        content: `<@!${BOT}> implement this`,
        referenced_message: {
          id: "42",
          content: "line one\nline two",
          author: { username: "pat" },
        },
      }),
      config,
    );
    expect(prompt).toBe(
      "implement this\n\nIn reply to this message from pat (Discord message 42):\n\n> line one\n> line two",
    );
  });
});

describe("runDiscordMentionsJob", () => {
  it("no-ops without config", async () => {
    const fetcher = vi.fn();
    expect(await runDiscordMentionsJob({ config: null, fetcher })).toEqual({ started: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("marks, starts and acknowledges each pending mention", async () => {
    const mention = msg();
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("messages?limit=50"))
        return Response.json([mention, msg({ mentions: [], seq: 3 })]);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    expect(await runDiscordMentionsJob({ config, fetcher, now: NOW })).toEqual({ started: 1 });
    expect(calls).toEqual([
      "GET https://discord.com/api/v10/channels/c/messages?limit=50",
      `PUT https://discord.com/api/v10/channels/c/messages/${mention.id}/reactions/%F0%9F%8C%92/@me`,
      "POST https://niteshift.test/hook",
      "POST https://discord.com/api/v10/channels/c/messages",
    ]);
  });

  it("does not start a task it could not mark", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith("limit=50") ? Response.json([msg()]) : new Response("", { status: 403 }),
    ) as unknown as typeof fetch;
    expect(await runDiscordMentionsJob({ config, fetcher, now: NOW })).toEqual({ started: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
