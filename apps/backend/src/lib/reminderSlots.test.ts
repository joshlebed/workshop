import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let testDb: ReturnType<typeof drizzle>;
let dbUsed = 0;
vi.mock("../db/client.js", () => ({
  getDb: () => {
    dbUsed++;
    return testDb;
  },
}));

import { runScheduledPlayReminders } from "../jobs/playReminders.js";
import {
  anySlotDue,
  localHour,
  noReminderCanBeDue,
  refreshReminderSlots,
} from "./reminderSlots.js";

const slotsFile = () => join(process.env.IMAGE_STORAGE_DIR ?? "", "state/play-reminder-slots.json");
const writeSlots = (value: unknown) => {
  mkdirSync(dirname(slotsFile()), { recursive: true });
  writeFileSync(slotsFile(), typeof value === "string" ? value : JSON.stringify(value));
};

async function rows(query: string, params: unknown[] = []) {
  await (testDb as unknown as { $client: PGlite }).$client.query(query, params);
}

const NY = "00000000-0000-4000-8000-000000000051";
const TOKYO = "00000000-0000-4000-8000-000000000052";
const OFF = "00000000-0000-4000-8000-000000000053";
// 2026-11-24 16:00 UTC = 11:00 in New York, 01:00 (next day) in Tokyo.
const ELEVEN_IN_NY = new Date("2026-11-24T16:00:00Z");
const NOON_IN_NY = new Date("2026-11-24T17:00:00Z");

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'ny@example.com', 'NY'), ($2, 'tokyo@example.com', 'Tokyo'), ($3, 'off@example.com', 'Off')`,
    [NY, TOKYO, OFF],
  );
  await rows(
    `INSERT INTO push_tokens (user_id, expo_push_token, platform, timezone, created_at, last_seen_at) VALUES
       ($1, 'ExponentPushToken[ny-old]', 'ios', 'America/Los_Angeles', now() - interval '9 days', now() - interval '9 days'),
       ($1, 'ExponentPushToken[ny]', 'ios', 'America/New_York', now(), now()),
       ($2, 'ExponentPushToken[tokyo]', 'ios', 'Asia/Tokyo', now(), now()),
       ($3, 'ExponentPushToken[off]', 'ios', 'Europe/London', now(), now())`,
    [NY, TOKYO, OFF],
  );
  await rows(
    `INSERT INTO notification_prefs (user_id, play_reminder_enabled, play_reminder_hour) VALUES
       ($1, true, 11), ($2, true, 20), ($3, false, 9)`,
    [NY, TOKYO, OFF],
  );
}, 60_000);

beforeEach(() => {
  rmSync(slotsFile(), { force: true });
  dbUsed = 0;
});

describe("localHour / anySlotDue", () => {
  it("reads the hour in a zone, including one on a half-hour offset", () => {
    expect(localHour(ELEVEN_IN_NY, "America/New_York")).toBe(11);
    expect(localHour(ELEVEN_IN_NY, "Asia/Tokyo")).toBe(1);
    expect(localHour(new Date("2026-11-24T18:45:00Z"), "Asia/Kolkata")).toBe(0);
    expect(localHour(ELEVEN_IN_NY, "Not/AZone")).toBeNull();
  });

  it("treats a zone it cannot read as due", () => {
    expect(anySlotDue([{ timezone: "Not/AZone", hour: 3 }], ELEVEN_IN_NY)).toBe(true);
    expect(anySlotDue([{ timezone: "Asia/Tokyo", hour: 20 }], ELEVEN_IN_NY)).toBe(false);
    expect(anySlotDue([], ELEVEN_IN_NY)).toBe(false);
  });
});

describe("stored reminder slots", () => {
  it("stores one slot per enabled user, in their latest device's timezone", async () => {
    await refreshReminderSlots(undefined, ELEVEN_IN_NY);
    const stored = JSON.parse(readFileSync(slotsFile(), "utf8")) as { slots: unknown };
    expect(stored.slots).toEqual([
      { timezone: "America/New_York", hour: 11 },
      { timezone: "Asia/Tokyo", hour: 20 },
    ]);
  });

  it("allows a skip only when the slots are present, fresh, and none is due", async () => {
    // Nothing stored: not sure, so no skip.
    expect(await noReminderCanBeDue(NOON_IN_NY)).toBe(false);

    await refreshReminderSlots(undefined, NOON_IN_NY);
    expect(await noReminderCanBeDue(NOON_IN_NY)).toBe(true);
    expect(await noReminderCanBeDue(ELEVEN_IN_NY)).toBe(false); // NY's 11:00
    expect(await noReminderCanBeDue(new Date("2026-11-24T11:00:00Z"))).toBe(false); // Tokyo's 20:00

    // A day later the same object is too old to trust.
    expect(await noReminderCanBeDue(new Date(NOON_IN_NY.getTime() + 25 * 3_600_000))).toBe(false);
    // Written "in the future" (clock trouble) is not trusted either.
    expect(await noReminderCanBeDue(new Date(NOON_IN_NY.getTime() - 3_600_000))).toBe(false);
  });

  it("does not skip on a malformed object", async () => {
    for (const bad of [
      "not json",
      { slots: [] },
      { writtenAt: NOON_IN_NY.toISOString(), slots: [{ hour: 3 }] },
    ]) {
      writeSlots(bad);
      expect(await noReminderCanBeDue(NOON_IN_NY)).toBe(false);
    }
  });
});

describe("runScheduledPlayReminders", () => {
  it("returns without touching the database when no reminder can be due", async () => {
    await refreshReminderSlots(undefined, NOON_IN_NY);
    dbUsed = 0;
    expect(await runScheduledPlayReminders(NOON_IN_NY)).toEqual({
      skipped: "no reminder due this hour",
    });
    expect(dbUsed).toBe(0);
  });

  it("runs the job and rewrites the slots when nothing is stored", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { status: "ok", id: "t1" },
            { status: "ok", id: "t2" },
          ],
        }),
        { status: 200 },
      ),
    );
    try {
      const result = await runScheduledPlayReminders(ELEVEN_IN_NY);
      // One user due (New York, 11:00), reminded on both of their devices.
      expect(result).toMatchObject({ candidates: 1, sent: 2 });
      expect(dbUsed).toBeGreaterThan(0);
      // The run left fresh slots behind, so the next empty hour is skipped.
      expect(await noReminderCanBeDue(new Date(Date.now() + 1000))).toBe(
        !anySlotDue(
          [
            { timezone: "America/New_York", hour: 11 },
            { timezone: "Asia/Tokyo", hour: 20 },
          ],
          new Date(Date.now() + 1000),
        ),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
