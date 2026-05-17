// Discord webhook notifier for operator-facing events (new signups, new lists).
// Posts to a single channel webhook configured via DISCORD_NOTIFY_WEBHOOK_URL.
// The webhook URL is itself the secret — there's no separate auth header — so
// we keep it in SSM SecureString and read it from the Lambda env at runtime.
//
// We await the POST (rather than fire-and-forget) because Lambda freezes the
// container after the response is returned, and an unawaited promise would be
// killed mid-flight. A 1.5s AbortSignal caps the worst case so a Discord
// outage can't add more than that to a signup/list-create. Failures log and
// swallow — Discord being down must never break a user request.
//
// When the env var is empty (local dev by default), the helper no-ops, so
// callers can sprinkle `await notifyDiscord(...)` without guards.

import { getConfig } from "./config.js";
import { logger } from "./logger.js";

const TIMEOUT_MS = 1500;

export async function notifyDiscord(content: string, fetcher: typeof fetch = fetch): Promise<void> {
  const url = getConfig().discordNotifyWebhookUrl;
  if (!url) return;
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("discord notify non-2xx", { status: res.status, body });
    }
  } catch (error) {
    logger.warn("discord notify threw", { error });
  }
}
