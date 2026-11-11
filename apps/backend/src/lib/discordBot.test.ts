import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "./config.js";

const send = vi.fn();
vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: class {
    send = send;
  },
  GetParameterCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { getDiscordBotConfig } = await import("./discordBot.js");

const valid = {
  botToken: "t",
  applicationId: "1",
  publicKey: "a".repeat(64),
  guildId: "g",
  channelId: "c",
  allowedUserIds: ["u"],
  niteshiftWebhookUrl: "https://niteshift.test/hook",
  niteshiftWebhookSecret: "s",
};

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://localhost/unused";
  process.env.SESSION_SECRET = "a".repeat(32);
  process.env.LOG_LEVEL = "error";
  resetConfigForTesting();
});

describe("getDiscordBotConfig", () => {
  it("is off with no env", async () => {
    expect(await getDiscordBotConfig({})).toBeNull();
  });

  it("is off for partial config (Niteshift fields only)", async () => {
    const env = { DISCORD_BOT_CONFIG: JSON.stringify({ niteshiftWebhookUrl: "https://x.test" }) };
    expect(await getDiscordBotConfig(env)).toBeNull();
  });

  it("reads SSM, caches for 5 minutes, then re-reads", async () => {
    send.mockReset().mockResolvedValue({ Parameter: { Value: JSON.stringify(valid) } });
    const env = { DISCORD_BOT_CONFIG_PARAM: "/p" };
    expect((await getDiscordBotConfig(env, 0))?.channelId).toBe("c");
    await getDiscordBotConfig(env, 4 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);
    send.mockResolvedValue({ Parameter: { Value: JSON.stringify({ ...valid, channelId: "c2" }) } });
    expect((await getDiscordBotConfig(env, 6 * 60_000))?.channelId).toBe("c2");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good config through an SSM failure", async () => {
    send.mockReset().mockResolvedValue({ Parameter: { Value: JSON.stringify(valid) } });
    const env = { DISCORD_BOT_CONFIG_PARAM: "/q" };
    await getDiscordBotConfig(env, 0);
    send.mockRejectedValue(new Error("throttled"));
    expect((await getDiscordBotConfig(env, 10 * 60_000))?.channelId).toBe("c");
  });
});
