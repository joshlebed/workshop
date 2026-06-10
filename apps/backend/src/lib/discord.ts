// Discord webhook notifier for operator-facing events (sign-ins, new lists).
// Posts to a single channel webhook configured via DISCORD_NOTIFY_WEBHOOK_URL.
// The webhook URL is itself the secret — there's no separate auth header — so
// we keep it in SSM SecureString and read it from the Lambda env at runtime.
//
// We await the POST (rather than fire-and-forget) because Lambda freezes the
// container after the response is returned, and an unawaited promise would be
// killed mid-flight. A 1.5s AbortSignal caps each attempt so a Discord outage
// can't add much to a signup/list-create. Failures log and swallow — Discord
// being down must never break a user request.
//
// Every outcome is logged so the signup→notify pipeline is observable from
// CloudWatch alone: a missing admin message can be triaged to "no event
// happened", "webhook not configured", or "Discord rejected it" without
// guessing. The success path logs too — previously the whole pipeline was
// silent on success, so "no message appeared" was indistinguishable from
// "the notifier never ran". Pass `kind` to tag which notification it was.
//
// When the env var is empty (local dev by default), the helper no-ops, so
// callers can sprinkle `await notifyDiscord(...)` without guards.

import { getConfig } from "./config.js";
import { logger } from "./logger.js";

const TIMEOUT_MS = 1500;
// One retry on a transient failure (429 rate-limit, 5xx, network/timeout). An
// operator notification is a low-volume, high-value event; a single transient
// hiccup shouldn't silently drop the only record of it. Non-transient
// rejections (4xx other than 429 — e.g. a deleted webhook) aren't retried since
// they'd just fail again.
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 400;

interface NotifyOptions {
  /** Short tag for logs/triage, e.g. "signup" or "new_list". */
  kind?: string;
  /** Injectable fetch for tests. */
  fetcher?: typeof fetch;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function notifyDiscord(content: string, opts: NotifyOptions = {}): Promise<void> {
  const { kind = "generic", fetcher = fetch } = opts;
  const url = getConfig().discordNotifyWebhookUrl;
  if (!url) {
    // Expected in local dev; a real clue in prod (webhook env unset/cleared).
    logger.info("discord notify skipped: webhook not configured", { kind });
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        logger.info("discord notify sent", { kind, status: res.status, attempt });
        return;
      }
      const body = await res.text().catch(() => "");
      const retryable = isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS;
      logger.warn("discord notify non-2xx", {
        kind,
        status: res.status,
        body,
        attempt,
        willRetry: retryable,
      });
      if (!retryable) return;
    } catch (error) {
      const willRetry = attempt < MAX_ATTEMPTS;
      logger.warn("discord notify threw", { kind, error, attempt, willRetry });
      if (!willRetry) return;
    }
    await sleep(RETRY_BACKOFF_MS);
  }
}
