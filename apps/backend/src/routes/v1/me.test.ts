import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

// Imported after the DB mock so auth and route queries use PGlite.
import { meRoutes } from "./me.js";

const peakUserId = "00000000-0000-4000-8000-000000000101";
const fallbackUserId = "00000000-0000-4000-8000-000000000102";

function authHeaders(userId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${signSession(userId)}`,
    "Content-Type": "application/json",
  };
}

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  const result = await client.query<T>(query, params);
  return result.rows;
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'peak@example.com', 'Peak Player'),
       ($2, 'fallback@example.com', 'Fallback Player')`,
    [peakUserId, fallbackUserId],
  );

  const gameRows = await rows<{ id: string }>(`SELECT id FROM games ORDER BY id LIMIT 5`);
  for (const [index, game] of gameRows.entries()) {
    // Three submissions at 20:xx Los Angeles time, then two at 09:xx.
    const createdAt =
      index < 3
        ? `2026-08-${String(10 + index).padStart(2, "0")}T03:15:00.000Z`
        : `2026-08-${String(10 + index).padStart(2, "0")}T16:15:00.000Z`;
    await rows(
      `INSERT INTO game_scores
         (game_id, user_id, period_key, score_raw, created_at, updated_at)
       VALUES ($1, $2, $3, 'played', $4, $4)`,
      [game.id, peakUserId, `2026-08-${String(10 + index).padStart(2, "0")}`, createdAt],
    );

    if (index < 4) {
      await rows(
        `INSERT INTO game_scores
           (game_id, user_id, period_key, score_raw, created_at, updated_at)
         VALUES ($1, $2, $3, 'played', $4, $4)`,
        [game.id, fallbackUserId, `2026-07-${String(10 + index).padStart(2, "0")}`, createdAt],
      );
    }
  }
}, 60_000);

describe("/v1/me push tokens", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetConfigForTesting();
  });

  it.each([
    ["local", "sandbox:a342b852a7cf0421caa3f63a1f3723db4ef7d03f14b4eb6b71f9409582409177"],
    ["prod", "ExpoPushToken[peak-user-device]"],
  ])(
    "stores and unregisters the %s token with the existing ownership rules",
    async (stage, storedToken) => {
      vi.stubEnv("STAGE", stage);
      vi.stubEnv("ENABLE_GAMES", "1");
      resetConfigForTesting();

      const expoPushToken = "ExpoPushToken[peak-user-device]";
      const register = (userId: string, timezone: string) =>
        meRoutes.request("/push-token", {
          method: "POST",
          headers: authHeaders(userId),
          body: JSON.stringify({
            expoPushToken: `  ${expoPushToken}  `,
            platform: "ios",
            timezone,
          }),
        });
      const unregister = (userId: string) =>
        meRoutes.request("/push-token", {
          method: "DELETE",
          headers: authHeaders(userId),
          body: JSON.stringify({ expoPushToken }),
        });
      const stored = () =>
        rows(
          `SELECT expo_push_token, user_id, timezone FROM push_tokens WHERE expo_push_token IN ($1, $2)`,
          [storedToken, expoPushToken],
        );

      const initialRegistration = await register(peakUserId, "America/Los_Angeles");
      expect(initialRegistration.status).toBe(200);
      expect(await initialRegistration.json()).toEqual({ ok: true });
      expect(await stored()).toEqual([
        { expo_push_token: storedToken, user_id: peakUserId, timezone: "America/Los_Angeles" },
      ]);

      expect((await register(fallbackUserId, "UTC")).status).toBe(200);
      expect((await unregister(peakUserId)).status).toBe(200);
      expect(await stored()).toEqual([
        { expo_push_token: storedToken, user_id: fallbackUserId, timezone: "UTC" },
      ]);

      const ownerDelete = await unregister(fallbackUserId);
      expect(ownerDelete.status).toBe(200);
      expect(await ownerDelete.json()).toEqual({ ok: true });
      expect(await stored()).toEqual([]);
    },
  );

  it("rejects a non-IANA timezone", async () => {
    const response = await meRoutes.request("/push-token", {
      method: "POST",
      headers: authHeaders(peakUserId),
      body: JSON.stringify({
        expoPushToken: "ExpoPushToken[invalid-timezone]",
        platform: "ios",
        timezone: "Eastern-ish",
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe("/v1/me notification preferences", () => {
  it("returns the most frequent local submission hour once history reaches five scores", async () => {
    await meRoutes.request("/push-token", {
      method: "POST",
      headers: authHeaders(peakUserId),
      body: JSON.stringify({
        expoPushToken: "ExpoPushToken[peak-suggestion-device]",
        platform: "ios",
        timezone: "America/Los_Angeles",
      }),
    });
    const response = await meRoutes.request("/notification-prefs", {
      headers: authHeaders(peakUserId),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      playReminderEnabled: false,
      playReminderHour: null,
      suggestedHour: 20,
    });
  });

  it("falls back to hour 11 with fewer than five scores", async () => {
    const response = await meRoutes.request("/notification-prefs", {
      headers: authHeaders(fallbackUserId),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ suggestedHour: 11 });
  });

  it("upserts valid preferences and rejects invalid enabled hours", async () => {
    const update = await meRoutes.request("/notification-prefs", {
      method: "PUT",
      headers: authHeaders(peakUserId),
      body: JSON.stringify({ playReminderEnabled: true, playReminderHour: 20 }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ playReminderEnabled: true, playReminderHour: 20 });

    const invalid = await meRoutes.request("/notification-prefs", {
      method: "PUT",
      headers: authHeaders(peakUserId),
      body: JSON.stringify({ playReminderEnabled: true, playReminderHour: 24 }),
    });
    expect(invalid.status).toBe(400);

    const missingHour = await meRoutes.request("/notification-prefs", {
      method: "PUT",
      headers: authHeaders(peakUserId),
      body: JSON.stringify({ playReminderEnabled: true, playReminderHour: null }),
    });
    expect(missingHour.status).toBe(400);
  });
});

describe("Games feature gate", () => {
  it("hides reminder routes when Games is disabled", async () => {
    process.env.STAGE = "prod";
    process.env.ENABLE_GAMES = "0";
    resetConfigForTesting();
    const response = await meRoutes.request("/notification-prefs");
    expect(response.status).toBe(404);

    process.env.STAGE = "local";
    delete process.env.ENABLE_GAMES;
    resetConfigForTesting();
  });
});
