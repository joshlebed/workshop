// `{ "job": "discord-mentions" }` — every minute, start a Niteshift task for
// each new `@Niteshift` mention in #workshop-admin.
//
// Mentions only arrive over Discord's gateway websocket, which a Lambda can't
// hold, so this polls the channel over REST instead. It is stateless: a handled
// message gets the bot's own 🌒 reaction (added *before* the task starts, so an
// overlapping run can't double-fire it), and a message older than
// MAX_AGE_MS is never picked up, so the first deploy can't replay history.

import {
  type DiscordBotConfig,
  type DiscordMessage,
  discordApi,
  discordMessageSchema,
  displayName,
  getDiscordBotConfig,
  HANDLED_EMOJI,
  promptFromMention,
  snowflakeTime,
  startedText,
  startNiteshiftTask,
} from "../lib/discordBot.js";
import { logger } from "../lib/logger.js";

const MAX_AGE_MS = 10 * 60 * 1000;

interface Deps {
  config?: DiscordBotConfig | null;
  fetcher?: typeof fetch;
  now?: number;
}

/** Messages this run should act on, oldest first. Pure; exported for tests. */
export function pendingMentions(
  messages: DiscordMessage[],
  config: DiscordBotConfig,
  now: number,
): DiscordMessage[] {
  const botId = config.applicationId; // a bot user's id is its application id
  return messages
    .filter(
      (m) =>
        !m.author.bot &&
        config.allowedUserIds.includes(m.author.id) &&
        m.mentions.some((u) => u.id === botId) &&
        now - snowflakeTime(m.id) <= MAX_AGE_MS &&
        !m.reactions?.some((r) => r.me && r.emoji.name === HANDLED_EMOJI),
    )
    .reverse();
}

export async function runDiscordMentionsJob(deps: Deps = {}): Promise<{ started: number }> {
  const config = deps.config === undefined ? getDiscordBotConfig() : deps.config;
  if (!config) return { started: 0 };
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now();

  const res = await discordApi(
    config,
    `/channels/${config.channelId}/messages?limit=50`,
    {},
    fetcher,
  );
  if (!res.ok) {
    logger.warn("discord mentions: read failed", { status: res.status });
    return { started: 0 };
  }
  const parsed = discordMessageSchema.array().safeParse(await res.json());
  if (!parsed.success) {
    logger.warn("discord mentions: unexpected payload");
    return { started: 0 };
  }

  let started = 0;
  for (const message of pendingMentions(parsed.data, config, now)) {
    const emoji = encodeURIComponent(HANDLED_EMOJI);
    const claim = await discordApi(
      config,
      `/channels/${config.channelId}/messages/${message.id}/reactions/${emoji}/@me`,
      { method: "PUT" },
      fetcher,
    );
    if (!claim.ok) {
      logger.warn("discord mentions: could not mark message", { status: claim.status });
      continue;
    }
    const taskUrl = await startNiteshiftTask(
      config,
      {
        prompt: promptFromMention(message, config.applicationId),
        author: displayName(message.author),
        messageId: message.id,
        source: "mention",
      },
      fetcher,
    );
    await discordApi(
      config,
      `/channels/${config.channelId}/messages`,
      {
        method: "POST",
        body: {
          content:
            taskUrl !== null
              ? startedText(taskUrl)
              : "⚠️ Niteshift didn't accept the task — check the API logs.",
          message_reference: { message_id: message.id, fail_if_not_exists: false },
          allowed_mentions: { parse: [] },
        },
      },
      fetcher,
    ).catch((error: unknown) => logger.warn("discord mentions: ack failed", { error }));
    if (taskUrl !== null) started++;
  }
  if (started) logger.info("discord mentions: tasks started", { started });
  return { started };
}
