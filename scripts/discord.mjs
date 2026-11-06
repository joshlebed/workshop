#!/usr/bin/env node
// #workshop-admin from the command line, as the Niteshift bot.
//
//   node scripts/discord.mjs read [--limit 20] [--json]   recent messages, oldest first
//   node scripts/discord.mjs post [--reply-to <id>] "text" (or text on stdin)
//   node scripts/discord.mjs setup --token-file <path> --channel <id> [--allow <userId,…>]
//       one-time: derive app id / public key / guild, write SSM bot_config
//   node scripts/discord.mjs register [--api-url <url>]
//       (re)register /niteshift + "Send to Niteshift" and point Discord's
//       Interactions Endpoint URL at the API. Run after the Lambda has the config.
//
// Config: $DISCORD_BOT_CONFIG (JSON) or SSM /workshop-prod/discord/bot_config,
// read with the ambient AWS credentials (the Niteshift sandbox role has them).
// Shape and runbook: apps/backend/src/lib/discordBot.ts, docs/discord-bot-runbook.md.
// Never paste the config or token into output — Actions logs on this repo are public.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PARAM = "/workshop-prod/discord/bot_config";
const API = "https://discord.com/api/v10";

function arg(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

function aws(...args) {
  return execFileSync("aws", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function ssmGet(name) {
  return aws(
    "ssm",
    "get-parameter",
    "--name",
    name,
    "--with-decryption",
    "--query",
    "Parameter.Value",
    "--output",
    "text",
  );
}

function loadConfig() {
  const raw = process.env.DISCORD_BOT_CONFIG || ssmGet(PARAM);
  const config = JSON.parse(raw);
  if (!config.botToken || !config.channelId) {
    throw new Error(
      `${PARAM} has no botToken/channelId yet — run \`setup\` first (docs/discord-bot-runbook.md)`,
    );
  }
  return config;
}

async function discord(token, path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const nameOf = (a) => a.global_name || a.username;

async function read(args) {
  const limit = Math.min(Number(arg(args, "--limit") ?? 20), 100);
  const json = flag(args, "--json");
  const config = loadConfig();
  const messages = (
    await discord(config.botToken, `/channels/${config.channelId}/messages?limit=${limit}`)
  ).reverse();
  if (json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }
  for (const m of messages) {
    const ref = m.referenced_message ? ` ↪ reply to ${m.referenced_message.id}` : "";
    const embeds = (m.embeds ?? [])
      .map((e) => [e.title, e.description].filter(Boolean).join(": "))
      .filter(Boolean);
    const files = (m.attachments ?? []).map((a) => `[attachment ${a.filename}: ${a.url}]`);
    const body = [m.content, ...embeds, ...files].filter(Boolean).join("\n");
    console.log(
      `--- ${m.timestamp} · ${nameOf(m.author)}${m.author.bot ? " (bot)" : ""} · id ${m.id}${ref}`,
    );
    console.log(body || "(no text)");
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function post(args) {
  const replyTo = arg(args, "--reply-to");
  const text = (args.join(" ") || (await readStdin())).trim();
  if (!text) throw new Error("nothing to post");
  const config = loadConfig();
  const sent = await discord(config.botToken, `/channels/${config.channelId}/messages`, {
    method: "POST",
    body: {
      content: text.slice(0, 2000),
      allowed_mentions: { parse: [] },
      ...(replyTo && replyTo !== "none"
        ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } }
        : {}),
    },
  });
  console.log(`posted ${sent.id}`);
}

async function setup(args) {
  const tokenFile = arg(args, "--token-file");
  const channelId = arg(args, "--channel");
  const extra = (arg(args, "--allow") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tokenFile || !channelId) throw new Error("setup needs --token-file and --channel");
  const botToken = readFileSync(tokenFile, "utf8").trim();

  const app = await discord(botToken, "/applications/@me");
  const channel = await discord(botToken, `/channels/${channelId}`);
  const owners = app.team ? app.team.members.map((m) => m.user.id) : [app.owner.id];

  // Keeps niteshiftWebhookUrl / niteshiftWebhookSecret (the automation's, set once).
  const existing = JSON.parse(ssmGet(PARAM));
  if (!existing.niteshiftWebhookUrl || !existing.niteshiftWebhookSecret) {
    throw new Error(
      `${PARAM} lacks the Niteshift webhook fields — see docs/discord-bot-runbook.md`,
    );
  }
  const config = {
    ...existing,
    botToken,
    applicationId: app.id,
    publicKey: app.verify_key,
    guildId: channel.guild_id,
    channelId,
    allowedUserIds: [...new Set([...(existing.allowedUserIds ?? []), ...owners, ...extra])],
  };
  aws(
    "ssm",
    "put-parameter",
    "--name",
    PARAM,
    "--type",
    "SecureString",
    "--overwrite",
    "--value",
    JSON.stringify(config),
    "--query",
    "Version",
    "--output",
    "text",
  );
  console.log(
    `wrote ${PARAM}: app ${app.id} (${app.name}), guild ${channel.guild_id}, #${channel.name}, ${config.allowedUserIds.length} allowed user(s)`,
  );
}

async function register(args) {
  const apiUrl =
    arg(args, "--api-url") ??
    aws(
      "apigatewayv2",
      "get-apis",
      "--query",
      "Items[?Name=='workshop-prod-api'].ApiEndpoint | [0]",
      "--output",
      "text",
    );
  const config = loadConfig();
  const commands = [
    {
      name: "niteshift",
      type: 1,
      description: "Start a Niteshift task on joshlebed/workshop",
      options: [
        { type: 3, name: "prompt", description: "What the agent should do", required: true },
      ],
      default_member_permissions: "8",
    },
    { name: "Send to Niteshift", type: 3, default_member_permissions: "8" },
  ];
  await discord(
    config.botToken,
    `/applications/${config.applicationId}/guilds/${config.guildId}/commands`,
    {
      method: "PUT",
      body: commands,
    },
  );
  // Discord PINGs the URL before accepting it, so the Lambda must already be
  // serving /discord/interactions with this config.
  const endpoint = `${apiUrl}/discord/interactions`;
  await discord(config.botToken, "/applications/@me", {
    method: "PATCH",
    body: { interactions_endpoint_url: endpoint },
  });
  console.log(
    `registered ${commands.length} commands in guild ${config.guildId}; interactions → ${endpoint}`,
  );
}

const [command, ...rest] = process.argv.slice(2);
const commands = { read, post, setup, register };
if (!commands[command]) {
  console.error("usage: node scripts/discord.mjs read|post|setup|register  (see header)");
  process.exit(2);
}
commands[command](rest).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
