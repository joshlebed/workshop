import type {
  DeletePushTokenRequest,
  NotificationPrefsResponse,
  PushTokenMutationResponse,
  RegisterPushTokenRequest,
  UpdateNotificationPrefsRequest,
  UpdateNotificationPrefsResponse,
} from "@workshop/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../../db/client.js";
import { notificationPrefs, pushTokens } from "../../db/schema.js";
import { reminderTimezoneForUser, suggestPlayReminderHour } from "../../jobs/playReminders.js";
import { getConfig } from "../../lib/config.js";
import { parseJsonBody } from "../../lib/request.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";

const expoPushTokenSchema = z
  .string()
  .trim()
  .max(255, "push token too long")
  .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/, "invalid Expo push token");

const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1, "timezone required")
  .max(100, "timezone too long")
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "invalid IANA timezone");

const registerPushTokenSchema = z.object({
  expoPushToken: expoPushTokenSchema,
  platform: z.enum(["ios", "android"]),
  timezone: ianaTimezoneSchema,
});

const deletePushTokenSchema = z.object({ expoPushToken: expoPushTokenSchema });

const updateNotificationPrefsSchema = z
  .object({
    playReminderEnabled: z.boolean(),
    playReminderHour: z.number().int().min(0).max(23).nullable(),
  })
  .refine((prefs) => !prefs.playReminderEnabled || prefs.playReminderHour !== null, {
    message: "play reminder hour required when enabled",
    path: ["playReminderHour"],
  });

export const meRoutes = new Hono();

// Daily-play reminders are part of the Games surface: same 404 flag gate as
// `/v1/games`, `/v1/game-share`, and `/v1/friends`.
meRoutes.use("*", async (c, next) => {
  const config = getConfig();
  if (!config.isLocal && !config.gamesEnabled) {
    return err(c, "NOT_FOUND", "not found");
  }
  await next();
});
meRoutes.use("*", requireAuth);

meRoutes.post("/push-token", async (c) => {
  const parsed = await parseJsonBody(c, registerPushTokenSchema);
  if (!parsed.ok) return parsed.response;
  const request: RegisterPushTokenRequest = parsed.data;
  const userId = c.get("userId");
  const now = new Date();
  const db = getDb();

  await db
    .insert(pushTokens)
    .values({
      userId,
      expoPushToken: request.expoPushToken,
      platform: request.platform,
      timezone: request.timezone,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: pushTokens.expoPushToken,
      set: {
        userId,
        platform: request.platform,
        timezone: request.timezone,
        lastSeenAt: now,
      },
    });

  const response: PushTokenMutationResponse = { ok: true };
  return ok(c, response);
});

meRoutes.delete("/push-token", async (c) => {
  const parsed = await parseJsonBody(c, deletePushTokenSchema);
  if (!parsed.ok) return parsed.response;
  const request: DeletePushTokenRequest = parsed.data;
  const userId = c.get("userId");
  const db = getDb();

  await db
    .delete(pushTokens)
    .where(and(eq(pushTokens.userId, userId), eq(pushTokens.expoPushToken, request.expoPushToken)));
  const response: PushTokenMutationResponse = { ok: true };
  return ok(c, response);
});

meRoutes.get("/notification-prefs", async (c) => {
  const userId = c.get("userId");
  const db = getDb();
  const [[prefs], timezone] = await Promise.all([
    db
      .select({
        playReminderEnabled: notificationPrefs.playReminderEnabled,
        playReminderHour: notificationPrefs.playReminderHour,
      })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId))
      .limit(1),
    reminderTimezoneForUser(userId, db),
  ]);
  const suggestedHour = await suggestPlayReminderHour(userId, timezone, db);
  const response: NotificationPrefsResponse = {
    playReminderEnabled: prefs?.playReminderEnabled ?? false,
    playReminderHour: prefs?.playReminderHour ?? null,
    suggestedHour,
  };
  return ok(c, response);
});

meRoutes.put("/notification-prefs", async (c) => {
  const parsed = await parseJsonBody(c, updateNotificationPrefsSchema);
  if (!parsed.ok) return parsed.response;
  const request: UpdateNotificationPrefsRequest = parsed.data;
  const userId = c.get("userId");
  const db = getDb();
  const [prefs] = await db
    .insert(notificationPrefs)
    .values({ userId, ...request })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: request,
    })
    .returning({
      playReminderEnabled: notificationPrefs.playReminderEnabled,
      playReminderHour: notificationPrefs.playReminderHour,
    });
  if (!prefs) return err(c, "NOT_FOUND", "user not found");

  const response: UpdateNotificationPrefsResponse = prefs;
  return ok(c, response);
});
