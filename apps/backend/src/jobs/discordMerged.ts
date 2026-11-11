// `{ "job": "discord-merged" }` — every 10 minutes, mark Discord-started tasks
// whose PR merged: ✅ on the starter message and a note in its task thread.
//
// The link is a `Discord-Message: <id>` line the task puts in its PR body (the
// automation prompt asks for it). One unauthenticated GitHub call per run (the
// repo is public; 6/hour is far under the 60/hour anonymous limit) lists recently
// closed PRs; the bot's own ✅ reaction is the "already done" marker, so the job
// is stateless and idempotent.

import { z } from "zod";
import {
  type DiscordBotConfig,
  discordApi,
  getDiscordBotConfig,
  postTaskUpdate,
} from "../lib/discordBot.js";
import { logger } from "../lib/logger.js";

const REPO = "joshlebed/workshop";
const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;
const DONE_EMOJI = "✅";
const MARKER = /^Discord-Message:\s*(\d{17,20})\s*$/m;

const prSchema = z.object({
  number: z.number(),
  title: z.string(),
  html_url: z.string(),
  merged_at: z.string().nullable(),
  body: z.string().nullable(),
});
type Pr = z.infer<typeof prSchema>;

/** Merged-in-window PRs that name a Discord message. Pure; exported for tests. */
export function mergedDiscordPrs(prs: Pr[], now: number): { pr: Pr; messageId: string }[] {
  return prs.flatMap((pr) => {
    if (!pr.merged_at || now - Date.parse(pr.merged_at) > LOOKBACK_MS) return [];
    const id = pr.body?.match(MARKER)?.[1];
    return id ? [{ pr, messageId: id }] : [];
  });
}

interface Deps {
  config?: DiscordBotConfig | null;
  fetcher?: typeof fetch;
  now?: number;
}

export async function runDiscordMergedJob(deps: Deps = {}): Promise<{ marked: number }> {
  const config = deps.config === undefined ? await getDiscordBotConfig() : deps.config;
  if (!config) return { marked: 0 };
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now();

  const res = await fetcher(
    `https://api.github.com/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "workshop-discord-bot" },
      signal: AbortSignal.timeout(4000),
    },
  ).catch(() => null);
  const prs = res?.ok ? z.array(prSchema).safeParse(await res.json()) : null;
  if (!prs?.success) {
    logger.warn("discord merged: GitHub read failed", { status: res?.status });
    return { marked: 0 };
  }

  let marked = 0;
  for (const { pr, messageId } of mergedDiscordPrs(prs.data, now)) {
    const msgRes = await discordApi(
      config,
      `/channels/${config.channelId}/messages/${messageId}`,
      {},
      fetcher,
    ).catch(() => null);
    if (!msgRes?.ok) continue; // deleted, or not in this channel
    const msg = z
      .object({
        reactions: z
          .array(z.object({ me: z.boolean(), emoji: z.object({ name: z.string().nullable() }) }))
          .optional(),
        thread: z.object({ id: z.string() }).optional(),
      })
      .safeParse(await msgRes.json());
    if (!msg.success) continue;
    if (msg.data.reactions?.some((r) => r.me && r.emoji.name === DONE_EMOJI)) continue;

    const react = await discordApi(
      config,
      `/channels/${config.channelId}/messages/${messageId}/reactions/${encodeURIComponent(DONE_EMOJI)}/@me`,
      { method: "PUT" },
      fetcher,
    ).catch(() => null);
    if (!react?.ok) continue;
    await postTaskUpdate(
      config,
      { threadId: msg.data.thread?.id, replyTo: messageId },
      `✅ Merged: #${pr.number} ${pr.title} — <${pr.html_url}>`,
      fetcher,
    );
    marked++;
  }
  if (marked) logger.info("discord merged: marked", { marked });
  return { marked };
}
