// Discord bot for #workshop-admin: lets the operator start a Niteshift task
// from Discord. Three entry points share this module:
//
//   - `POST /discord/interactions` (routes/discordInteractions.ts): the
//     `/niteshift <prompt>` slash command and the "Send to Niteshift" message
//     context-menu command. Discord signs every request with Ed25519.
//   - `{ "job": "discord-mentions" }` (jobs/discordMentions.ts): a per-minute
//     poll for `@Niteshift` mentions. Mentions are gateway-only events and a
//     Lambda can't hold a websocket, so we read the channel over REST and mark
//     handled messages with the bot's own 🌒 reaction (stateless: no table).
//   - `scripts/discord.mjs` (agents): read / post / register commands. Same
//     config, read from SSM.
//
// All config is one JSON blob in SSM `/workshop-prod/discord/bot_config`. The
// Lambda reads it at runtime (`DISCORD_BOT_CONFIG_PARAM` = the parameter name,
// cached CACHE_MS per container) so `scripts/discord.mjs setup` takes effect
// within minutes, no Terraform apply. `DISCORD_BOT_CONFIG` (inline JSON) wins
// when set — tests and local dev. Neither set, or invalid = feature off.
// Shape: {@link DiscordBotConfig}. Runbook: docs/discord-bot-runbook.md.

import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { logger } from "./logger.js";

const discordBotConfigSchema = z.object({
  botToken: z.string().min(1),
  applicationId: z.string().min(1),
  /** The bot's managed role; `@Niteshift` often autocompletes to it. Set by `setup`. */
  botRoleId: z.string().min(1).optional(),
  /** Hex Ed25519 key from the Developer Portal (General Information). */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/i),
  guildId: z.string().min(1),
  channelId: z.string().min(1),
  /** Discord user ids allowed to start tasks. Everyone else is refused. */
  allowedUserIds: z.array(z.string().min(1)).min(1),
  niteshiftWebhookUrl: z.string().url(),
  niteshiftWebhookSecret: z.string().min(1),
});
export type DiscordBotConfig = z.infer<typeof discordBotConfigSchema>;

const CACHE_MS = 5 * 60 * 1000;
let cached: { key: string; at: number; config: DiscordBotConfig | null } | null = null;

function parseDiscordBotConfig(raw: string | undefined): DiscordBotConfig | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = discordBotConfigSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    logger.warn("discord bot config invalid", {
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`),
    });
  } catch {
    logger.warn("discord bot config is not JSON");
  }
  return null;
}

async function readSsmParameter(name: string): Promise<string | undefined> {
  // Lazy: the SDK is provided by the Lambda runtime and only this path needs it.
  const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
  const out = await new SSMClient({}).send(
    new GetParameterCommand({ Name: name, WithDecryption: true }),
  );
  return out.Parameter?.Value;
}

/** The bot config, or null when unset/invalid/unreadable (feature off). */
export async function getDiscordBotConfig(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<DiscordBotConfig | null> {
  const inline = env.DISCORD_BOT_CONFIG;
  const param = env.DISCORD_BOT_CONFIG_PARAM;
  const key = inline?.trim() ? `inline:${inline}` : param ? `ssm:${param}` : "";
  if (cached && cached.key === key && (key.startsWith("inline:") || now - cached.at < CACHE_MS)) {
    return cached.config;
  }
  let config: DiscordBotConfig | null = null;
  if (inline?.trim()) config = parseDiscordBotConfig(inline);
  else if (param) {
    try {
      config = parseDiscordBotConfig(await readSsmParameter(param));
    } catch (error) {
      logger.warn("discord bot config: SSM read failed", { error });
      // Keep serving the last good config through a transient SSM failure.
      if (cached?.key === key) config = cached.config;
    }
  }
  cached = { key, at: now, config };
  return config;
}

// --- Signature verification --------------------------------------------------

// DER prefix that wraps a raw 32-byte Ed25519 public key as SubjectPublicKeyInfo.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
): boolean {
  if (!signatureHex || !timestamp || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

// --- Niteshift ---------------------------------------------------------------

export interface TaskRequest {
  prompt: string;
  /** Display name of the Discord user who asked. */
  author: string;
  /** Message to reply to when the task finishes, if there is one. */
  messageId?: string;
  source: "slash_command" | "message_command" | "mention";
}

/**
 * Fire the "Discord /niteshift → task" automation. The payload's top-level
 * fields are prepended verbatim (as JSON) to the automation prompt, which
 * refers to them by name — Niteshift does not fill in `{{placeholders}}`. Niteshift answers `{ ok, taskIds }`;
 * returns the new task's URL, `""` when accepted without an id, or null when
 * it was not accepted.
 */
export async function startNiteshiftTask(
  config: DiscordBotConfig,
  req: TaskRequest,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetcher(config.niteshiftWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.niteshiftWebhookSecret}`,
      },
      body: JSON.stringify({
        prompt: req.prompt,
        author: req.author,
        messageId: req.messageId ?? "none",
        source: req.source,
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const body = webhookResponseSchema.safeParse(await res.json().catch(() => null));
      const taskId = body.success ? (body.data.taskIds?.[0] ?? "") : "";
      logger.info("niteshift task started from discord", { source: req.source, taskId });
      return taskId ? `https://niteshift.dev/t/${taskId}` : "";
    }
    logger.warn("niteshift webhook non-2xx", {
      status: res.status,
      body: (await res.text().catch(() => "")).slice(0, 500),
    });
  } catch (error) {
    logger.warn("niteshift webhook threw", { error });
  }
  return null;
}

const webhookResponseSchema = z.object({ taskIds: z.array(z.string()).optional() });

/** "🌒 Started a Niteshift task" + link, for Discord replies. */
export function startedText(taskUrl: string): string {
  return taskUrl ? `🌒 Started a Niteshift task: <${taskUrl}>` : "🌒 Started a Niteshift task.";
}

// --- Discord REST ------------------------------------------------------------

const API = "https://discord.com/api/v10";
export const HANDLED_EMOJI = "🌒";

export async function discordApi(
  config: DiscordBotConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return fetcher(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bot ${config.botToken}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(4000),
  });
}

export const discordMessageSchema = z.object({
  id: z.string(),
  content: z.string(),
  author: z.object({
    id: z.string(),
    username: z.string(),
    global_name: z.string().nullish(),
    bot: z.boolean().optional(),
  }),
  mentions: z.array(z.object({ id: z.string() })).default([]),
  mention_roles: z.array(z.string()).default([]),
  reactions: z
    .array(z.object({ me: z.boolean(), emoji: z.object({ name: z.string().nullable() }) }))
    .optional(),
  referenced_message: z
    .object({
      id: z.string(),
      content: z.string(),
      author: z.object({ username: z.string(), global_name: z.string().nullish() }),
    })
    .nullish(),
});
export type DiscordMessage = z.infer<typeof discordMessageSchema>;

export function displayName(author: {
  username: string;
  global_name?: string | null | undefined;
}): string {
  return author.global_name || author.username;
}

/** Snowflake → creation time (ms since epoch). */
export function snowflakeTime(id: string): number {
  return Number((BigInt(id) >> 22n) + 1420070400000n);
}

// Discord doesn't run a slash command typed inside a reply — it posts the text.
// Treat a message that starts with `/niteshift` as a trigger, so "reply to a
// feedback message with /niteshift fix this" works like an @mention.
const TEXT_COMMAND = /^\s*\/niteshift\b/i;

/**
 * Does this message ask the bot for a task? An @mention of the bot user (a bot
 * user's id is its application id), of its managed role, or a text
 * `/niteshift …`.
 */
export function triggersBot(message: DiscordMessage, config: DiscordBotConfig): boolean {
  return (
    message.mentions.some((u) => u.id === config.applicationId) ||
    (config.botRoleId !== undefined && message.mention_roles.includes(config.botRoleId)) ||
    TEXT_COMMAND.test(message.content)
  );
}

/** Strip the trigger (mentions of the bot / its role, a leading `/niteshift`). */
function stripTrigger(content: string, config: DiscordBotConfig): string {
  let out = content.replace(new RegExp(`<@!?${config.applicationId}>`, "g"), "");
  if (config.botRoleId) out = out.replace(new RegExp(`<@&${config.botRoleId}>`, "g"), "");
  return out.replace(TEXT_COMMAND, "").trim();
}

/**
 * The task prompt for a message that triggers the bot. A reply carries the
 * message it replied to, so "@Niteshift implement this" under a feedback
 * message hands the agent both.
 */
export function promptFromMention(message: DiscordMessage, config: DiscordBotConfig): string {
  const ask = stripTrigger(message.content, config) || "Act on the message below.";
  const ref = message.referenced_message;
  if (!ref) return ask;
  return `${ask}\n\nIn reply to this message from ${displayName(ref.author)} (Discord message ${ref.id}):\n\n${quote(ref.content)}`;
}

export function quote(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}
