// `{ "job": "discord-health" }` — daily self-check of the #workshop-admin bot.
//
// The bot can break silently: a Save in the Developer Portal blanked the
// Interactions Endpoint URL once and /niteshift just stopped answering. This
// checks what can be checked over REST and, when something is wrong, says so in
// #workshop-admin through the *notify webhook* (which doesn't depend on the bot).
// A blank/wrong endpoint URL is repaired in place when `interactionsUrl` is in
// the config (written by `scripts/discord.mjs register`).

import { z } from "zod";
import { notifyDiscord } from "../lib/discord.js";
import { type DiscordBotConfig, discordApi, getDiscordBotConfig } from "../lib/discordBot.js";
import { logger } from "../lib/logger.js";

const MESSAGE_CONTENT_INTENT = (1 << 18) | (1 << 19);
const EXPECTED_COMMANDS = ["niteshift", "Send to Niteshift"];

const appSchema = z.object({
  flags: z.number().optional(),
  interactions_endpoint_url: z.string().nullish(),
});

interface Deps {
  config?: DiscordBotConfig | null;
  /** Whether a config is expected at all (prod sets the SSM param name). */
  configured?: boolean;
  fetcher?: typeof fetch;
  notify?: (content: string) => Promise<void>;
}

/** Problems found (empty = healthy) and repairs made. */
async function checkDiscordBot(
  config: DiscordBotConfig,
  fetcher: typeof fetch = fetch,
): Promise<{ problems: string[]; repaired: string[] }> {
  const problems: string[] = [];
  const repaired: string[] = [];
  const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
    discordApi(config, path, init, fetcher).catch(() => null);

  const appRes = await call("/applications/@me");
  if (!appRes?.ok) {
    problems.push(
      appRes?.status === 401
        ? "bot token rejected (401) — reset it and re-run `node scripts/discord.mjs setup`"
        : `couldn't read the application (${appRes?.status ?? "network error"})`,
    );
    return { problems, repaired }; // nothing else can be checked without the token
  }
  const app = appSchema.safeParse(await appRes.json());
  if (app.success) {
    if (((app.data.flags ?? 0) & MESSAGE_CONTENT_INTENT) === 0) {
      problems.push("Message Content Intent is off — the bot reads empty messages (portal → Bot)");
    }
    const url = app.data.interactions_endpoint_url ?? null;
    if (config.interactionsUrl && url !== config.interactionsUrl) {
      const fix = await call("/applications/@me", {
        method: "PATCH",
        body: { interactions_endpoint_url: config.interactionsUrl },
      });
      if (fix?.ok) repaired.push(`Interactions Endpoint URL was ${url ?? "blank"}; re-set it`);
      else problems.push(`Interactions Endpoint URL is ${url ?? "blank"} and re-setting it failed`);
    } else if (!url) {
      problems.push("Interactions Endpoint URL is blank — run `node scripts/discord.mjs register`");
    }
  }

  const cmdRes = await call(
    `/applications/${config.applicationId}/guilds/${config.guildId}/commands`,
  );
  const cmds = cmdRes?.ok
    ? z.array(z.object({ name: z.string() })).safeParse(await cmdRes.json())
    : null;
  const names = cmds?.success ? cmds.data.map((c) => c.name) : [];
  const missing = EXPECTED_COMMANDS.filter((n) => !names.includes(n));
  if (missing.length) {
    problems.push(`commands not registered: ${missing.join(", ")} — run \`register\``);
  }

  const readRes = await call(`/channels/${config.channelId}/messages?limit=1`);
  if (!readRes?.ok) {
    problems.push(
      `can't read #workshop-admin (${readRes?.status ?? "network error"}) — check the bot's channel permissions`,
    );
  }
  return { problems, repaired };
}

export async function runDiscordHealthJob(deps: Deps = {}): Promise<{ ok: boolean }> {
  const configured = deps.configured ?? Boolean(process.env.DISCORD_BOT_CONFIG_PARAM);
  const config = deps.config === undefined ? await getDiscordBotConfig() : deps.config;
  const notify =
    deps.notify ??
    ((content: string) =>
      notifyDiscord(content, { kind: "discord_bot_health", withClient: false }));

  if (!config) {
    if (configured)
      await notify(
        "🩺 Niteshift bot: config missing or invalid in SSM — see docs/discord-bot-runbook.md",
      );
    return { ok: !configured };
  }
  const { problems, repaired } = await checkDiscordBot(config, deps.fetcher);
  logger.info("discord health", { problems, repaired });
  if (problems.length || repaired.length) {
    const lines = [...problems.map((p) => `• ⚠️ ${p}`), ...repaired.map((r) => `• 🔧 ${r}`)];
    await notify(`🩺 Niteshift bot health check\n${lines.join("\n")}`);
  }
  return { ok: problems.length === 0 };
}
