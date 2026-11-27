// Device push-token registration + "turn reminders on". Everything goes
// through the `pushNotifications` facade, so on web and pre-1.2.0 binaries
// each function is a cheap no-op.

import type { NotificationPrefs } from "@workshop/shared";
import type { PushPromptTrigger } from "@workshop/shared/constants";
import {
  deletePushToken,
  fetchNotificationPrefs,
  registerPushToken,
  saveNotificationPrefs,
} from "../api/notifications";
import { reportPushPrompt } from "../api/telemetry";
import {
  getPermissionStatus,
  getPushToken,
  isPushSupported,
  type PushPermissionStatus,
  pushPlatform,
  requestPermissionAndToken,
} from "./pushNotifications";

/** Device IANA zone; the reminder hour is interpreted in it server-side. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Per app launch (module state): which user this device's token was posted
// for, and the token itself so sign-out can unregister without asking Expo.
let registeredForUser: string | null = null;
let lastPushToken: string | null = null;

async function postToken(authToken: string, userId: string, pushToken: string): Promise<void> {
  await registerPushToken(authToken, {
    expoPushToken: pushToken,
    platform: pushPlatform,
    timezone: deviceTimezone(),
  });
  registeredForUser = userId;
  lastPushToken = pushToken;
}

/**
 * On launch / sign-in: if permission is already granted, (re-)post the token —
 * at most once per launch per user. The post also bumps `last_seen_at` and the
 * timezone. Never prompts. Swallows failures (the next launch retries).
 */
export async function registerPushTokenIfGranted(authToken: string, userId: string): Promise<void> {
  if (registeredForUser === userId || !isPushSupported()) return;
  registeredForUser = userId;
  try {
    const pushToken = await getPushToken();
    if (pushToken) await postToken(authToken, userId, pushToken);
  } catch {
    registeredForUser = null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** Sign-out: best-effort `DELETE /v1/me/push-token`. Never throws, never blocks long. */
export async function unregisterPushToken(authToken: string | null): Promise<void> {
  const known = lastPushToken;
  registeredForUser = null;
  lastPushToken = null;
  if (!authToken || !isPushSupported()) return;
  try {
    const pushToken = known ?? (await withTimeout(getPushToken(), 3000, null));
    if (pushToken) await withTimeout(deletePushToken(authToken, pushToken), 3000, null);
  } catch {
    /* best-effort — the job prunes DeviceNotRegistered tokens anyway */
  }
}

/**
 * `requestPermissionAndToken`, reporting the push funnel: when the OS had not
 * been asked yet (so its dialog is about to show), the ask itself (`accepted`,
 * for triggers with no pre-prompt of ours — the post-score sheet reports its
 * own answer) and the dialog's answer (`os_granted` / `os_denied`).
 */
async function requestAndReport(authToken: string, trigger: PushPromptTrigger) {
  const before = await getPermissionStatus().catch(() => "unsupported" as const);
  const asking = before === "undetermined";
  if (asking && trigger !== "post_score") void reportPushPrompt(authToken, "accepted", trigger);
  const result = await requestPermissionAndToken();
  if (asking && result.status === "granted")
    void reportPushPrompt(authToken, "os_granted", trigger);
  if (asking && result.status === "denied") void reportPushPrompt(authToken, "os_denied", trigger);
  return result;
}

export type EnableReminderResult =
  | { ok: true; prefs: NotificationPrefs }
  | { ok: false; status: PushPermissionStatus };

/**
 * The user asked for reminders: OS permission (shows the system dialog when
 * undetermined) → post the token → enable at the stored hour, else the
 * server's `suggestedHour` (peak posting hour, 11 by default). The token is
 * posted before the prefs read so the suggestion uses this device's zone.
 */
export async function enablePlayReminder(
  authToken: string,
  userId: string,
  trigger: PushPromptTrigger,
): Promise<EnableReminderResult> {
  const { status, token: pushToken } = await requestAndReport(authToken, trigger);
  if (status !== "granted") return { ok: false, status };
  if (pushToken) await postToken(authToken, userId, pushToken);
  const current = await fetchNotificationPrefs(authToken);
  const prefs = await saveNotificationPrefs(authToken, {
    playReminderEnabled: true,
    playReminderHour: current.playReminderHour ?? current.suggestedHour,
  });
  return { ok: true, prefs };
}

/** Whether this device can now receive (and so, for pokes, send) pushes. */
export type PushReadiness = "ready" | "denied" | "dismissed" | "unsupported";

/**
 * Make sure this device is registered for push, asking the OS if it hasn't
 * been asked yet (call it from a tap). `ready` means the token is posted;
 * `unsupported` covers web, old binaries and a device that can't mint a token.
 */
export async function ensurePushRegistered(
  authToken: string,
  userId: string,
  trigger: PushPromptTrigger,
): Promise<PushReadiness> {
  if (!isPushSupported()) return "unsupported";
  const { status, token: pushToken } = await requestAndReport(authToken, trigger);
  if (status === "granted" && pushToken) {
    await postToken(authToken, userId, pushToken);
    return "ready";
  }
  if (status === "denied") return "denied";
  return status === "undetermined" ? "dismissed" : "unsupported";
}

/** `13` → `1 PM`. */
export function formatReminderHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}
