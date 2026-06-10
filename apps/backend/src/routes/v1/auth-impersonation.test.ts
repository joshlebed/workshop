import { PGlite } from "@electric-sql/pglite";
import type { AuthResponse, Me } from "@workshop/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { notifyDiscord } from "../../lib/discord.js";
import { signSession, verifySession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

vi.mock("../../lib/discord.js", () => ({
  notifyDiscord: vi.fn(),
}));

import { authRoutes, buildImpersonationNotification } from "./auth.js";

const adminId = "00000000-0000-4000-8000-000000000301";
const targetId = "00000000-0000-4000-8000-000000000302";
const otherId = "00000000-0000-4000-8000-000000000303";

function authHeaders(asUser: string, token = signSession(asUser)): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function rows(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  await client.query(query, params);
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
       ($1, 'joshlebed@gmail.com', 'Josh'),
       ($2, 'target@example.com', 'Target User'),
       ($3, 'other@example.com', 'Other User')`,
    [adminId, targetId, otherId],
  );
}, 60_000);

beforeEach(() => {
  vi.mocked(notifyDiscord).mockClear();
});

describe("buildImpersonationNotification", () => {
  it("includes the admin, target, and stable ids", () => {
    expect(
      buildImpersonationNotification(
        { id: adminId, email: "joshlebed@gmail.com", displayName: "Josh" },
        { id: targetId, email: "target@example.com", displayName: "Target User" },
      ),
    ).toEqual({
      content: `:mag: impersonation started: Josh, joshlebed@gmail.com, ${adminId} -> Target User, target@example.com, ${targetId}`,
      kind: "impersonation",
    });
  });
});

describe("admin impersonation routes", () => {
  it("returns the server-authored admin flag from /me", async () => {
    const adminRes = await authRoutes.request("/me", { headers: authHeaders(adminId) });
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as Me;
    expect(adminBody.user.isAdmin).toBe(true);
    expect(adminBody.impersonation).toBeNull();

    const otherRes = await authRoutes.request("/me", { headers: authHeaders(otherId) });
    expect(otherRes.status).toBe(200);
    const otherBody = (await otherRes.json()) as Me;
    expect(otherBody.user.isAdmin).toBe(false);
  });

  it("rejects non-admin users", async () => {
    const res = await authRoutes.request("/impersonate", {
      method: "POST",
      headers: authHeaders(otherId),
      body: JSON.stringify({ target: "target@example.com" }),
    });

    expect(res.status).toBe(403);
    expect(notifyDiscord).not.toHaveBeenCalled();
  });

  it("lets an admin mint an impersonated session by target email", async () => {
    const res = await authRoutes.request("/impersonate", {
      method: "POST",
      headers: authHeaders(adminId),
      body: JSON.stringify({ target: "target@example.com" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthResponse;
    expect(body.user.id).toBe(targetId);
    expect(body.user.isAdmin).toBe(false);
    expect(body.impersonation).toEqual({
      adminUserId: adminId,
      adminEmail: "joshlebed@gmail.com",
      adminDisplayName: "Josh",
    });
    expect(verifySession(body.token)).toMatchObject({
      userId: targetId,
      impersonatorUserId: adminId,
    });
    expect(notifyDiscord).toHaveBeenCalledWith(expect.stringContaining("impersonation started"), {
      kind: "impersonation",
    });

    const meRes = await authRoutes.request("/me", { headers: authHeaders(targetId, body.token) });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as Me;
    expect(meBody.user.id).toBe(targetId);
    expect(meBody.impersonation?.adminUserId).toBe(adminId);
  });

  it("stops impersonating by returning a normal admin session", async () => {
    const startRes = await authRoutes.request("/impersonate", {
      method: "POST",
      headers: authHeaders(adminId),
      body: JSON.stringify({ target: targetId }),
    });
    expect(startRes.status).toBe(200);
    const started = (await startRes.json()) as AuthResponse;

    const stopRes = await authRoutes.request("/impersonation/stop", {
      method: "POST",
      headers: authHeaders(targetId, started.token),
    });

    expect(stopRes.status).toBe(200);
    const stopped = (await stopRes.json()) as AuthResponse;
    expect(stopped.user.id).toBe(adminId);
    expect(stopped.user.isAdmin).toBe(true);
    expect(stopped.impersonation).toBeNull();
    expect(verifySession(stopped.token)).toMatchObject({ userId: adminId });
    expect(verifySession(stopped.token)?.impersonatorUserId).toBeUndefined();
  });
});
