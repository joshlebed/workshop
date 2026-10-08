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
// `sessionRevocation.js` is globally mocked in test-setup, so mark access-token
// use the way the real `recordAccessTokenUse` does — directly on the row.
async function recordAccessTokenUse(sessionId: string, version: number) {
  await sql(
    `UPDATE auth_sessions SET last_used_refresh_version = $2
       WHERE id = $1 AND (last_used_refresh_version IS NULL OR last_used_refresh_version < $2)`,
    [sessionId, version],
  );
}

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

  it("re-issues the current token when the previous one is presented and the current one was never used", async () => {
    // The client's refresh succeeded server-side but the response was lost in
    // flight (app backgrounded / killed). Nothing has used v2's access token,
    // so a late v1 presentation is the same client retrying, not a replay.
    const created = await createDeviceSession({ userId: ownerId, now: start });
    const rotatedAt = new Date(start.getTime() + 60_000);
    const rotated = await rotateDeviceSession(created.refreshToken, rotatedAt);
    expect(rotated.reissued).toBe(false);

    const late = await rotateDeviceSession(
      created.refreshToken,
      new Date(rotatedAt.getTime() + 24 * 60 * 60 * 1000),
    );
    expect(late.reissued).toBe(true);
    expect(late.refreshToken).toBe(rotated.refreshToken);
    expect(late.session.refreshVersion).toBe(2);
    expect(late.session.revokedAt).toBeNull();

    // The re-issued credential then rotates normally.
    const next = await rotateDeviceSession(
      late.refreshToken,
      new Date(rotatedAt.getTime() + 2 * 24 * 60 * 60 * 1000),
    );
    expect(next.session.refreshVersion).toBe(3);
    expect(next.reissued).toBe(false);
  });

  it("revokes the device when an older token is replayed after the newer one was used", async () => {
    const created = await createDeviceSession({ userId: ownerId, now: start });
    const rotatedAt = new Date(start.getTime() + 60_000);
    const rotated = await rotateDeviceSession(created.refreshToken, rotatedAt);
    // The holder of v2 made an authenticated request with its access token.
    await recordAccessTokenUse(rotated.session.id, rotated.session.refreshVersion);

    await expect(
      rotateDeviceSession(created.refreshToken, new Date(rotatedAt.getTime() + 10_001)),
    ).rejects.toMatchObject({ reason: "reused", sessionUserId: ownerId });
    await expect(
      rotateDeviceSession(rotated.refreshToken, new Date(rotatedAt.getTime() + 10_002)),
    ).rejects.toMatchObject({ reason: "expired" });
  });

  it("revokes the device when a token two or more versions behind is presented", async () => {
    const created = await createDeviceSession({ userId: ownerId, now: start });
    const t1 = new Date(start.getTime() + 60_000);
    const v2 = await rotateDeviceSession(created.refreshToken, t1);
    const t2 = new Date(t1.getTime() + 60_000);
    await rotateDeviceSession(v2.refreshToken, t2);

    // v1 is two behind: the newer credential chain has clearly moved on
    // without this holder, regardless of access-token usage.
    await expect(
      rotateDeviceSession(created.refreshToken, new Date(t2.getTime() + 60_000)),
    ).rejects.toMatchObject({ reason: "reused", sessionUserId: ownerId });
  });

  it("records access-token use monotonically", async () => {
    const created = await createDeviceSession({ userId: ownerId, now: start });
    await recordAccessTokenUse(created.session.id, 3);
    await recordAccessTokenUse(created.session.id, 2);
    const {
      rows: [row],
    } = await sql("SELECT last_used_refresh_version FROM auth_sessions WHERE id = $1", [
      created.session.id,
    ]);
    expect(row?.last_used_refresh_version).toBe(3);
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
