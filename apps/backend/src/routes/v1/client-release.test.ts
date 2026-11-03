// The operator-only App Store update nudge: public read (`GET /v1/client/release`)
// and the single admin write path (`PUT /v1/admin/client-release`). Real SQL
// against PGlite with the actual drizzle/ migrations.

import { PGlite } from "@electric-sql/pglite";
import type { AdminClientReleaseResponse, ClientReleaseResponse } from "@workshop/shared";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/client.js", () => ({
  getDb: () => testDb,
}));

import { compareReleaseVersions } from "../../lib/clientReleases.js";
import { adminRoutes } from "./admin.js";
import { clientRoutes } from "./client.js";

const adminId = "00000000-0000-4000-8000-000000000701";
const playerId = "00000000-0000-4000-8000-000000000702";

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const asAdmin = () => headers(signSession(adminId));
const asPlayer = () => headers(signSession(playerId));

async function rows<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  const client = (testDb as unknown as { $client: PGlite }).$client;
  return (await client.query<T>(query, params)).rows;
}

const nudge = {
  client: "highscore",
  platform: "ios",
  latestVersion: "1.2.0",
  minimumVersion: "1.0.0",
  storeUrl: "https://apps.apple.com/app/id6805206753",
  message: "New boards!",
};

function put(body: unknown, h: Record<string, string> = asAdmin()) {
  return adminRoutes.request("/client-release", {
    method: "PUT",
    headers: h,
    body: JSON.stringify(body),
  });
}

async function publicRelease(platform = "ios"): Promise<ClientReleaseResponse> {
  const res = await clientRoutes.request(`/release?client=highscore&platform=${platform}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ClientReleaseResponse;
}

const NULLS = { latestVersion: null, minimumVersion: null, storeUrl: null, message: null };

beforeAll(async () => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();
  testDb = drizzle(new PGlite());
  await migrate(testDb, { migrationsFolder: "./drizzle" });
  await rows(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'joshlebed@gmail.com', 'Josh'),
       ($2, 'player@example.com', 'Player')`,
    [adminId, playerId],
  );
}, 60_000);

describe("compareReleaseVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareReleaseVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareReleaseVersions("1.0.1", "1.0.1")).toBe(0);
    expect(compareReleaseVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });
});

describe("GET /v1/client/release", () => {
  it("returns all nulls with no row — no migration seeds a nudge", async () => {
    expect(await rows("SELECT * FROM client_releases")).toEqual([]);
    const res = await clientRoutes.request("/release?client=highscore&platform=ios");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    expect(await res.json()).toEqual(NULLS);
  });

  it("needs no session but validates client + platform", async () => {
    expect((await clientRoutes.request("/release?client=nope&platform=ios")).status).toBe(400);
    expect((await clientRoutes.request("/release?client=highscore")).status).toBe(400);
  });
});

describe("PUT /v1/admin/client-release", () => {
  it("403s a non-admin and writes nothing", async () => {
    const res = await put(nudge, asPlayer());
    expect(res.status).toBe(403);
    expect(await publicRelease()).toEqual(NULLS);
  });

  it("403s a non-admin's GET of the admin view", async () => {
    const res = await adminRoutes.request("/client-release?client=highscore&platform=ios", {
      headers: asPlayer(),
    });
    expect(res.status).toBe(403);
  });

  it("401s with no session", async () => {
    const res = await adminRoutes.request("/client-release", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nudge),
    });
    expect(res.status).toBe(401);
  });

  it.each([
    ["non-semver latest", { latestVersion: "1.2" }],
    ["prefixed version", { minimumVersion: "v1.0.0" }],
    ["minimum above latest", { latestVersion: "1.0.0", minimumVersion: "1.1.0" }],
    ["http store url", { storeUrl: "http://apps.apple.com/app/id1" }],
    ["unknown platform", { platform: "windows" }],
    ["unknown client", { client: "other" }],
    ["extra key", { extra: true }],
    ["overlong message", { message: "x".repeat(281) }],
  ])("400s %s", async (_label, patch) => {
    const res = await put({ ...nudge, ...patch });
    expect(res.status).toBe(400);
    expect(await publicRelease()).toEqual(NULLS);
  });

  it("round-trips through the public GET and records who changed it", async () => {
    const res = await put(nudge);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminClientReleaseResponse;
    expect(body).toMatchObject({ ...nudge, updatedBy: { id: adminId, displayName: "Josh" } });
    expect(body.updatedAt).toEqual(expect.any(String));

    expect(await publicRelease()).toEqual({
      latestVersion: "1.2.0",
      minimumVersion: "1.0.0",
      storeUrl: nudge.storeUrl,
      message: "New boards!",
    });
    // Scoped to (client, platform).
    expect(await publicRelease("android")).toEqual(NULLS);

    const adminView = await adminRoutes.request("/client-release?client=highscore&platform=ios", {
      headers: asAdmin(),
    });
    expect(adminView.status).toBe(200);
    expect(((await adminView.json()) as AdminClientReleaseResponse).latestVersion).toBe("1.2.0");
  });

  it("an impersonating admin passes the gate and is recorded as themselves", async () => {
    const token = signSession(playerId, { impersonatorUserId: adminId });
    const res = await put({ ...nudge, latestVersion: "1.3.0" }, headers(token));
    expect(res.status).toBe(200);
    const [row] = await rows<{ updated_by: string }>(
      "SELECT updated_by FROM client_releases WHERE client = 'highscore' AND platform = 'ios'",
    );
    expect(row?.updated_by).toBe(adminId);
  });

  it("null (and blank) clears every value", async () => {
    const res = await put({
      client: "highscore",
      platform: "ios",
      latestVersion: null,
      minimumVersion: "",
      storeUrl: null,
      message: "  ",
    });
    expect(res.status).toBe(200);
    expect(await publicRelease()).toEqual(NULLS);
  });
});
