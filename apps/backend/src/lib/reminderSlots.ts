import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { notificationPrefs, pushTokens } from "../db/schema.js";
import { getImageObject, imageStorageAvailable, putImageObject } from "./imageStorage.js";
import { logger } from "./logger.js";
import { type DbClient, executeRows } from "./sql.js";

/**
 * Lets the hourly play-reminder job skip the database in hours when nobody
 * has a reminder set.
 *
 * Neon bills by the hour the database is awake and keeps it awake ~5 minutes
 * after any query, so a job that queries every hour cost ~2 awake hours a day
 * on its own. Most hours have nothing to send: reminders are set by a handful
 * of users at a few local hours.
 *
 * The "slots" are the distinct (timezone, local hour) pairs with a reminder
 * enabled. They are kept as a small JSON object in object storage (the same
 * bucket as uploaded images, under `state/`), which the job can read without
 * waking the database.
 *
 * The rule that keeps this safe: **the job only skips when it is sure.** A
 * missing, unreadable, malformed or day-old slots object means "ask the
 * database", exactly as before. The object is rewritten after every change to
 * reminder settings or push tokens and after every run that did ask the
 * database.
 */
const SLOTS_KEY = "state/play-reminder-slots.json";

/** Older than this, the object is not trusted and the database is asked. */
const MAX_AGE_MS = 24 * 3_600_000;

interface ReminderSlot {
  timezone: string;
  hour: number;
}

interface StoredSlots {
  writtenAt: string;
  slots: ReminderSlot[];
}

/** The hour of the day at `now` in `timezone`, or null when the zone is not one we can read. */
export function localHour(now: Date, timezone: string): number | null {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now);
    const value = Number(hour);
    return Number.isInteger(value) ? value : null;
  } catch {
    return null;
  }
}

/** Could any slot be due at `now`? A zone we cannot read counts as due. */
export function anySlotDue(slots: ReminderSlot[], now: Date): boolean {
  return slots.some((slot) => {
    const hour = localHour(now, slot.timezone);
    return hour === null || hour === slot.hour;
  });
}

function parseStored(body: Buffer): StoredSlots | null {
  try {
    const value: unknown = JSON.parse(body.toString("utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { writtenAt, slots } = value as { writtenAt?: unknown; slots?: unknown };
    if (typeof writtenAt !== "string" || !Array.isArray(slots)) return null;
    const parsed: ReminderSlot[] = [];
    for (const slot of slots) {
      const { timezone, hour } = (slot ?? {}) as { timezone?: unknown; hour?: unknown };
      if (typeof timezone !== "string" || typeof hour !== "number") return null;
      parsed.push({ timezone, hour });
    }
    return { writtenAt, slots: parsed };
  } catch {
    return null;
  }
}

/**
 * True only when the stored slots are present, fresh, and none is due at
 * `now`: the one case where the reminder job may skip the database.
 */
export async function noReminderCanBeDue(now: Date): Promise<boolean> {
  try {
    if (!imageStorageAvailable()) return false;
    const body = await getImageObject(SLOTS_KEY);
    const stored = body ? parseStored(body) : null;
    if (!stored) return false;
    const age = now.getTime() - Date.parse(stored.writtenAt);
    if (!(age >= 0 && age < MAX_AGE_MS)) return false;
    return !anySlotDue(stored.slots, now);
  } catch (error) {
    logger.warn("reminder slots unreadable; asking the database", { error });
    return false;
  }
}

/**
 * Rewrites the stored slots from the database. Uses the same "latest device
 * is the account's timezone" rule as the job's own query, so the stored set
 * always covers everyone the job would pick.
 */
export async function refreshReminderSlots(
  db: DbClient = getDb(),
  now: Date = new Date(),
): Promise<void> {
  if (!imageStorageAvailable()) return;
  const slots = await executeRows<ReminderSlot>(
    db,
    sql`
      WITH canonical_timezones AS (
        SELECT DISTINCT ON (${pushTokens.userId})
          ${pushTokens.userId} AS user_id,
          ${pushTokens.timezone} AS timezone
        FROM ${pushTokens}
        ORDER BY
          ${pushTokens.userId},
          ${pushTokens.lastSeenAt} DESC,
          ${pushTokens.createdAt} DESC,
          ${pushTokens.expoPushToken} ASC
      )
      SELECT DISTINCT canonical.timezone, ${notificationPrefs.playReminderHour}::int AS hour
      FROM ${notificationPrefs}
      INNER JOIN canonical_timezones canonical ON canonical.user_id = ${notificationPrefs.userId}
      WHERE ${notificationPrefs.playReminderEnabled} = true
        AND ${notificationPrefs.playReminderHour} IS NOT NULL
      ORDER BY 1, 2
    `,
  );
  const stored: StoredSlots = {
    writtenAt: now.toISOString(),
    slots: slots.map((s) => ({ timezone: s.timezone, hour: Number(s.hour) })),
  };
  await putImageObject(SLOTS_KEY, Buffer.from(JSON.stringify(stored)), "application/json");
}

/**
 * `refreshReminderSlots` for request paths: a failure is logged, never
 * surfaced. The stored slots then go stale and the job falls back to the
 * database within a day.
 */
export async function refreshReminderSlotsQuietly(db: DbClient = getDb()): Promise<void> {
  try {
    await refreshReminderSlots(db);
  } catch (error) {
    logger.warn("reminder slots refresh failed", { error });
  }
}
