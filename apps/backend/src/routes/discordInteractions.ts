// Discord Interactions endpoint for the #workshop-admin bot. Discord POSTs here
// for the `/niteshift <prompt>` slash command and the "Send to Niteshift"
// message command (registered by `node scripts/discord.mjs register`). Every
// request is Ed25519-signed with the application's public key; an unsigned or
// mis-signed request is a 401, which is also what Discord's endpoint check
// expects. 404 when the bot isn't configured (local dev, tests, prod before
// DISCORD_BOT_CONFIG is set). See lib/discordBot.ts.

import { Hono } from "hono";
import { z } from "zod";
import {
  type DiscordBotConfig,
  getDiscordBotConfig,
  quote,
  startedText,
  startNiteshiftTask,
  type TaskRequest,
  verifyDiscordSignature,
} from "../lib/discordBot.js";
import { logger } from "../lib/logger.js";

export const discordInteractionRoutes = new Hono();

// https://discord.com/developers/docs/interactions/receiving-and-responding
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const EPHEMERAL = 1 << 6;

const SLASH_COMMAND = "niteshift";
const MESSAGE_COMMAND = "Send to Niteshift";

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullish(),
});

const interactionSchema = z.object({
  type: z.number(),
  channel_id: z.string().optional(),
  member: z.object({ user: userSchema }).optional(),
  user: userSchema.optional(),
  data: z
    .object({
      name: z.string(),
      target_id: z.string().optional(),
      options: z.array(z.object({ name: z.string(), value: z.unknown() })).optional(),
      resolved: z
        .object({
          messages: z
            .record(
              z.string(),
              z.object({ id: z.string(), content: z.string(), author: userSchema }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
});
type Interaction = z.infer<typeof interactionSchema>;

const reply = (content: string, ephemeral = false) => ({
  type: CHANNEL_MESSAGE,
  data: {
    content: content.slice(0, 2000),
    flags: ephemeral ? EPHEMERAL : 0,
    allowed_mentions: { parse: [] },
  },
});

const nameOf = (u: z.infer<typeof userSchema>) => u.global_name || u.username;

/** Interaction → task request, or an error string to show the caller. */
function taskRequestFor(
  interaction: Interaction,
  config: DiscordBotConfig,
): TaskRequest | { error: string } {
  const user = interaction.member?.user ?? interaction.user;
  if (!user || !config.allowedUserIds.includes(user.id)) {
    return { error: "You're not allowed to start Niteshift tasks." };
  }
  if (interaction.channel_id && interaction.channel_id !== config.channelId) {
    return { error: `Use this in <#${config.channelId}>.` };
  }
  const data = interaction.data;
  if (data?.name === SLASH_COMMAND) {
    const prompt = data.options?.find((o) => o.name === "prompt")?.value;
    if (typeof prompt !== "string" || !prompt.trim()) return { error: "Give the task a prompt." };
    return { prompt: prompt.trim(), author: nameOf(user), source: "slash_command" };
  }
  if (data?.name === MESSAGE_COMMAND && data.target_id) {
    const target = data.resolved?.messages?.[data.target_id];
    if (!target) return { error: "Couldn't read that message." };
    return {
      // Neutral on purpose: who wrote it, which message, the text. What to do
      // about it is the agent's call (or the operator's, via /niteshift).
      prompt: `Discord message from ${nameOf(target.author)} (message ${target.id}):\n\n${quote(target.content)}`,
      author: nameOf(user),
      messageId: target.id,
      source: "message_command",
    };
  }
  return { error: "Unknown command." };
}

discordInteractionRoutes.post("/interactions", async (c) => {
  const config = await getDiscordBotConfig();
  if (!config) return c.json({ error: "not found" }, 404);

  const rawBody = await c.req.text();
  const ok = verifyDiscordSignature(
    config.publicKey,
    c.req.header("x-signature-ed25519"),
    c.req.header("x-signature-timestamp"),
    rawBody,
  );
  if (!ok) return c.json({ error: "invalid request signature" }, 401);

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const parsed = interactionSchema.safeParse(json);
  if (!parsed.success) return c.json({ error: "bad interaction" }, 400);
  const interaction = parsed.data;

  if (interaction.type === PING) return c.json({ type: PONG });
  if (interaction.type !== APPLICATION_COMMAND) return c.json(reply("Unsupported.", true));

  const req = taskRequestFor(interaction, config);
  if ("error" in req) {
    logger.info("discord interaction refused", { reason: req.error });
    return c.json(reply(req.error, true));
  }
  // Discord gives us 3s to answer; startNiteshiftTask caps itself at 2.5s.
  const taskUrl = await startNiteshiftTask(config, req);
  if (taskUrl === null)
    return c.json(reply("⚠️ Niteshift didn't accept the task — check the API logs.", true));
  const shown = req.source === "slash_command" ? `\n${quote(req.prompt.slice(0, 1500))}` : "";
  return c.json(reply(`${startedText(taskUrl)} (for ${req.author})${shown}`));
});
