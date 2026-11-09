import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { resetConfigForTesting } from "../lib/config.js";
import { type DiscordBotConfig, verifyDiscordSignature } from "../lib/discordBot.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");

const OPERATOR = "111";
const CHANNEL = "222";
const config: DiscordBotConfig = {
  botToken: "bot-token",
  applicationId: "999",
  publicKey: publicKeyHex,
  guildId: "333",
  channelId: CHANNEL,
  allowedUserIds: [OPERATOR],
  niteshiftWebhookUrl: "https://niteshift.test/hook",
  niteshiftWebhookSecret: "hook-secret",
};

function signed(body: unknown, key = privateKey) {
  const raw = JSON.stringify(body);
  const timestamp = "1700000000";
  const signature = sign(null, Buffer.from(timestamp + raw), key).toString("hex");
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature-Ed25519": signature,
      "X-Signature-Timestamp": timestamp,
    },
    body: raw,
  };
}

const slash = (userId: string, prompt: string, channel = CHANNEL) => ({
  type: 2,
  channel_id: channel,
  member: { user: { id: userId, username: "josh", global_name: "Josh" } },
  data: { name: "niteshift", options: [{ name: "prompt", value: prompt }] },
});

describe("POST /discord/interactions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://localhost/unused";
    process.env.SESSION_SECRET = "a".repeat(32);
    process.env.LOG_LEVEL = "error";
    process.env.DISCORD_BOT_CONFIG = JSON.stringify(config);
    resetConfigForTesting();
    fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    delete process.env.DISCORD_BOT_CONFIG;
    vi.unstubAllGlobals();
  });

  it("404s when the bot is not configured", async () => {
    delete process.env.DISCORD_BOT_CONFIG;
    const res = await buildApp().request("/discord/interactions", signed({ type: 1 }));
    expect(res.status).toBe(404);
  });

  it("answers Discord's PING", async () => {
    const res = await buildApp().request("/discord/interactions", signed({ type: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it("401s a request signed with another key", async () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const res = await buildApp().request("/discord/interactions", signed({ type: 1 }, other));
    expect(res.status).toBe(401);
  });

  it("401s an unsigned request", async () => {
    const res = await buildApp().request("/discord/interactions", {
      method: "POST",
      body: JSON.stringify({ type: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("starts a task for the operator's slash command", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, taskIds: ["task_abc"] }));
    const res = await buildApp().request(
      "/discord/interactions",
      signed(slash(OPERATOR, "fix the bug")),
    );
    const body = (await res.json()) as { data: { content: string; flags: number } };
    expect(body.data.content).toContain(
      "Started a Niteshift task: <https://niteshift.dev/t/task_abc>",
    );
    expect(body.data.flags).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(config.niteshiftWebhookUrl);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hook-secret");
    expect(JSON.parse(init.body as string)).toMatchObject({
      prompt: "fix the bug",
      author: "Josh",
      messageId: "none",
      source: "slash_command",
    });
  });

  it("refuses anyone not on the allowlist, without calling Niteshift", async () => {
    const res = await buildApp().request("/discord/interactions", signed(slash("666", "rm -rf")));
    const body = (await res.json()) as { data: { content: string; flags: number } };
    expect(body.data.content).toMatch(/not allowed/);
    expect(body.data.flags).toBe(64);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses other channels", async () => {
    const res = await buildApp().request(
      "/discord/interactions",
      signed(slash(OPERATOR, "x", "444")),
    );
    const body = (await res.json()) as { data: { content: string } };
    expect(body.data.content).toContain("<#222>");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns the message command's target into the prompt and reply target", async () => {
    await buildApp().request(
      "/discord/interactions",
      signed({
        type: 2,
        channel_id: CHANNEL,
        member: { user: { id: OPERATOR, username: "josh" } },
        data: {
          name: "Send to Niteshift",
          target_id: "555",
          resolved: {
            messages: {
              "555": {
                id: "555",
                content: "the share button is broken",
                author: { id: "7", username: "pat" },
              },
            },
          },
        },
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { prompt: string; messageId: string };
    expect(payload.prompt).toContain("> the share button is broken");
    expect(payload.prompt).toContain("from pat");
    expect(payload.messageId).toBe("555");
  });

  it("tells the operator when Niteshift rejects the task", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const res = await buildApp().request("/discord/interactions", signed(slash(OPERATOR, "x")));
    const body = (await res.json()) as { data: { content: string } };
    expect(body.data.content).toContain("didn't accept");
  });
});

describe("verifyDiscordSignature", () => {
  it("rejects malformed signatures without throwing", () => {
    expect(verifyDiscordSignature(publicKeyHex, "zz", "1", "{}")).toBe(false);
    expect(verifyDiscordSignature(publicKeyHex, undefined, "1", "{}")).toBe(false);
    expect(verifyDiscordSignature("00".repeat(32), "ab".repeat(64), "1", "{}")).toBe(false);
  });
});
