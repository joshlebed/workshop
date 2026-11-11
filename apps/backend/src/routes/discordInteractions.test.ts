import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { resetConfigForTesting } from "../lib/config.js";
import {
  type DiscordBotConfig,
  UNTRUSTED_NOTE,
  verifyDiscordSignature,
} from "../lib/discordBot.js";

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
  let calls: string[] = [];
  let hookResponse: () => Response;
  let threadResponse: () => Response;
  const hookPayload = () => {
    const call = fetchMock.mock.calls.find(([url]) => url === config.niteshiftWebhookUrl) as
      | [string, RequestInit]
      | undefined;
    return {
      init: call?.[1],
      body: JSON.parse((call?.[1].body as string) ?? "null") as Record<string, string>,
    };
  };

  beforeEach(() => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://localhost/unused";
    process.env.SESSION_SECRET = "a".repeat(32);
    process.env.LOG_LEVEL = "error";
    process.env.DISCORD_BOT_CONFIG = JSON.stringify(config);
    resetConfigForTesting();
    hookResponse = () => Response.json({ ok: true, taskIds: ["task_abc"] });
    threadResponse = () => Response.json({ id: "t" }, { status: 201 });
    // Route by URL: Discord REST (starter message, thread, thread post) and the Niteshift hook.
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace("https://discord.com/api/v10", "")}`);
      if (url === config.niteshiftWebhookUrl) return hookResponse();
      if (url.endsWith("/threads")) return threadResponse();
      if (url.endsWith(`/channels/${CHANNEL}/messages`)) return Response.json({ id: "900" });
      return Response.json({ id: "901" });
    });
    calls = [];
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

  it("slash command: posts a starter, opens a thread, starts the task, answers privately", async () => {
    const res = await buildApp().request(
      "/discord/interactions",
      signed(slash(OPERATOR, "fix the bug")),
    );
    const body = (await res.json()) as { data: { content: string; flags: number } };
    expect(body.data.content).toBe(
      "🌒 Started a Niteshift task: <https://niteshift.dev/t/task_abc> — follow along in <#900>",
    );
    expect(body.data.flags).toBe(64);
    expect(calls).toEqual([
      "POST /channels/222/messages",
      "POST /channels/222/messages/900/threads",
      `POST ${config.niteshiftWebhookUrl}`,
      "POST /channels/900/messages",
    ]);
    const { init, body: payload } = hookPayload();
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
      "Bearer hook-secret",
    );
    expect(payload).toMatchObject({
      prompt: "fix the bug",
      author: "Josh",
      messageId: "900",
      threadId: "900",
      source: "slash_command",
    });
  });

  it("slash command without thread permission still starts the task and answers publicly", async () => {
    threadResponse = () => Response.json({ code: 50013 }, { status: 403 });
    const res = await buildApp().request("/discord/interactions", signed(slash(OPERATOR, "x")));
    const body = (await res.json()) as { data: { content: string; flags: number } };
    expect(body.data.content).toContain("Started a Niteshift task");
    expect(body.data.flags).toBe(0);
    expect(hookPayload().body.threadId).toBe("none");
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
    const payload = hookPayload().body;
    expect(payload.prompt).toBe(
      'The operator sent this Discord message to Niteshift:\n\n<untrusted_discord_message author="pat" message_id="555">\nthe share button is broken\n</untrusted_discord_message>\n' +
        UNTRUSTED_NOTE,
    );
    expect(payload.messageId).toBe("555");
    expect(payload.threadId).toBe("555");
  });

  it("message command on a message that already has a task thread starts nothing", async () => {
    threadResponse = () => Response.json({ code: 160004 }, { status: 400 });
    const res = await buildApp().request(
      "/discord/interactions",
      signed({
        type: 2,
        channel_id: CHANNEL,
        member: { user: { id: OPERATOR, username: "josh" } },
        data: {
          name: "Send to Niteshift",
          target_id: "555",
          resolved: {
            messages: { "555": { id: "555", content: "x", author: { id: "7", username: "pat" } } },
          },
        },
      }),
    );
    const body = (await res.json()) as { data: { content: string } };
    expect(body.data.content).toBe("That message already has a task thread: <#555>");
    expect(hookPayload().init).toBeUndefined();
  });

  it("tells the operator when Niteshift rejects the task", async () => {
    hookResponse = () => new Response("nope", { status: 500 });
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
