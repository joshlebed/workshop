# Discord bot runbook (#workshop-admin ↔ Niteshift)

The **Niteshift** Discord bot lets agents read and post in `#workshop-admin`, and lets the
operator start a Niteshift task from Discord three ways:

| How                                                      | Path                                                         | Latency |
| -------------------------------------------------------- | ------------------------------------------------------------ | ------- |
| `/niteshift prompt:<text>`                               | Discord → `POST <api>/discord/interactions` → Niteshift      | instant |
| Right-click a message → Apps → **Send to Niteshift**     | same; the message text is the prompt, the task replies to it | instant |
| `@Niteshift <text>` (optionally as a reply to a message) | `{job: "discord-mentions"}` polls every minute               | ≤ 1 min |
| A message starting `/niteshift <text>` (e.g. in a reply) | same poll — Discord doesn't run slash commands in replies    | ≤ 1 min |

Each one fires the Niteshift automation **"Discord /niteshift → task"**
(<https://niteshift.dev/automations/aut__pCmyroVGLTOEY-mPObcx>, repo `joshlebed/workshop`),
which sends `{ prompt, author, messageId, source }`. Niteshift prepends that JSON to the
automation prompt as-is and does **not** fill in `{{placeholders}}`, so the automation prompt
names the fields instead. Only Discord user ids in
`allowedUserIds` can start tasks; the commands are also limited to server admins and to the
configured channel. A handled mention gets the bot's 🌒 reaction.

## Config

One SecureString, `/workshop-prod/discord/bot_config`, read by the Lambda at runtime (env
`DISCORD_BOT_CONFIG_PARAM` holds its name; cached 5 minutes per container):

```json
{
  "botToken": "…",
  "applicationId": "…",
  "publicKey": "<hex>",
  "guildId": "…",
  "channelId": "…",
  "allowedUserIds": ["…"],
  "niteshiftWebhookUrl": "https://niteshift.dev/api/automations/webhooks/whk_…",
  "niteshiftWebhookSecret": "…"
}
```

Terraform only adopts the parameter (`ignore_changes = [value]`); the value is written by
`node scripts/discord.mjs setup`. A new value reaches the Lambda within ~5 minutes; no apply.
Empty/partial config = everything is a no-op (route 404s, job returns). `botRoleId` is
optional (`setup` fills it): `@Niteshift` often autocompletes to the bot's role, not its user.

## One-time setup (operator)

1. <https://discord.com/developers/applications> → **New Application** → name it `Niteshift`.
2. **Bot** tab → **Reset Token** → copy it. Turn on **Message Content Intent**. Turn off
   **Public Bot**.
3. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions
   View Channels, Send Messages, Read Message History, Add Reactions. Open the URL, add the
   bot to the server.
4. In Discord: Settings → Advanced → **Developer Mode** on; right-click `#workshop-admin` →
   **Copy Channel ID**. Make sure the bot's role can see that channel.
5. Give the token + channel id to an agent (Niteshift task secrets), which runs:

```bash
node scripts/discord.mjs setup --token-file /root/.niteshift/task-secrets/DISCORD_BOT_TOKEN --channel <id>
# app owner is auto-allowed; add others with --allow <userId,…>
```

6. Apply so the Lambda gets the config (merge the PR that adds `infra/discord_bot.tf`, or any
   later infra PR), then:

```bash
node scripts/discord.mjs register   # slash + message command, Interactions Endpoint URL
```

`register` fails if the Lambda isn't serving the config yet — Discord PINGs the endpoint
before saving it. **Re-run it after any Save in the Developer Portal**: the portal writes the
whole form and can blank the Interactions Endpoint URL (that happened when the Message Content
Intent was turned on); `register` now checks the URL stuck.

## Agents

```bash
node scripts/discord.mjs read --limit 30          # oldest first, ids + reply refs + attachments
node scripts/discord.mjs post "Shipped #123"      # as the bot
node scripts/discord.mjs post --reply-to <id> "…"
```

Message text is real user feedback — fine in the sandbox, never in a public Actions log.

## Troubleshooting

- **Logs**: `./scripts/logs.sh --filter discord` — `discord interaction refused`,
  `niteshift webhook non-2xx`, `discord mentions: …`, `discord bot config invalid`.
- **"This interaction failed"** in Discord: the route took > 3s or 5xx'd. Niteshift's webhook is
  capped at 2.5s.
- **Rotate the bot token**: Reset Token in the portal, re-run `setup`, then `register`.
- **Rotate the Niteshift webhook secret**: on the automation page, then edit
  `niteshiftWebhookSecret` in the SSM JSON.
- **Mentions not picked up**: the bot needs Read Message History + Message Content Intent; the
  message must be < 10 min old, from an allowed user, and not already 🌒-reacted by the bot.
