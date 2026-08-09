import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "./config.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../db/client.js", () => ({
  getDb: () => testDb,
}));

const { createDeviceSession, rotateDeviceSession, setDeviceSessionImpersonation } = await import(
  "./deviceSessions.js"
);

const ownerId = "00000000-0000-4000-8000-000000000501";
const targetId = "00000000-0000-4000-8000-000000000502";
const start = new Date("2026-01-01T00:00:00.000Z");

async function sql(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return client.query<Record<string, unknown>>(query, params);
}

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "s".repeat(32);
  resetConfigForTesting();

  const pglite = new PGlite();
  testDb = drizzle(pglite);
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await sql(
    "INSERT INTO users (id, email) VALUES ($1, 'owner@example.com'), ($2, 'target@example.com')",
    [ownerId, targetId],
  );
}, 60_000);

beforeEach(async () => {
  await sql("DELETE FROM auth_sessions");
});

describe("managed device sessions", () => {
  it("creates a 180-day idle session with a one-year hard cap", async () => {
    const created = await createDeviceSession({
      userId: ownerId,
      metadata: { platform: "ios", appVersion: "1.2.3" },
      now: start,
    });

    expect(created.refreshToken).toMatch(/^r1\./);
    expect(created.session.refreshVersion).toBe(1);
    expect(created.session.platform).toBe("ios");
    expect(created.session.idleExpiresAt.getTime() - start.getTime()).toBe(
      180 * 24 * 60 * 60 * 1000,
    );
    expect(created.session.absoluteExpiresAt.getTime() - start.getTime()).toBe(
      365 * 24 * 60 * 60 * 1000,
    );
  });

  it("rotates the refresh token and tolerates an immediate duplicate request", async () => {
    const created = await createDeviceSession({ userId: ownerId, now: start });
    const first = await rotateDeviceSession(
      created.refreshToken,
      new Date(start.getTime() + 24 * 60 * 60 * 1000),
    );
    const duplicate = await rotateDeviceSession(
      created.refreshToken,
      new Date(start.getTime() + 24 * 60 * 60 * 1000 + 5_000),
    );

    expect(first.session.refreshVersion).toBe(2);
    expect(duplicate.refreshToken).toBe(first.refreshToken);
  });

  it("revokes the device when an older token is replayed outside the grace window", async () => {
    const created = await createDeviceSession({ userId: ownerId, now: start });
    const rotatedAt = new Date(start.getTime() + 60_000);
    const rotated = await rotateDeviceSession(created.refreshToken, rotatedAt);

    await expect(
      rotateDeviceSession(created.refreshToken, new Date(rotatedAt.getTime() + 10_001)),
    ).rejects.toMatchObject({ reason: "reused" });
    await expect(
      rotateDeviceSession(rotated.refreshToken, new Date(rotatedAt.getTime() + 10_002)),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("rejects refresh after the idle or absolute expiry", async () => {
    const idle = await createDeviceSession({ userId: ownerId, now: start });
    await expect(
      rotateDeviceSession(idle.refreshToken, new Date(start.getTime() + 181 * 24 * 60 * 60 * 1000)),
    ).rejects.toMatchObject({ reason: "expired" });

    const absolute = await createDeviceSession({ userId: ownerId, now: start });
    const first = await rotateDeviceSession(
      absolute.refreshToken,
      new Date(start.getTime() + 170 * 24 * 60 * 60 * 1000),
    );
    const nearCap = await rotateDeviceSession(
      first.refreshToken,
      new Date(start.getTime() + 340 * 24 * 60 * 60 * 1000),
    );
    await expect(
      rotateDeviceSession(
        nearCap.refreshToken,
        new Date(start.getTime() + 366 * 24 * 60 * 60 * 1000),
      ),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("stores impersonation on the session so refreshes preserve the principal", async () => {
    const created = await createDeviceSession({ userId: ownerId, now: start });
    expect(await setDeviceSessionImpersonation(created.session.id, ownerId, targetId, start)).toBe(
      true,
    );
    const rotated = await rotateDeviceSession(
      created.refreshToken,
      new Date(start.getTime() + 60_000),
    );
    expect(rotated.session.impersonatedUserId).toBe(targetId);
  });
});
