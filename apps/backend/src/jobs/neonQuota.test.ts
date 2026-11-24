import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../lib/config.js";
import type { DbClient } from "../lib/sql.js";
import {
  buildQuotaMessage,
  evaluateQuota,
  type NeonUsage,
  runNeonQuotaJob,
  usageFromProject,
} from "./neonQuota.js";

const GB = 1_000_000_000;
const HOUR = 3600;
const periodStart = new Date("2026-11-01T00:00:00Z");
const periodEnd = new Date("2026-12-01T00:00:00Z");
const day = (n: number) => new Date(periodStart.getTime() + (n - 1) * 86_400_000);
const usage = (transferGb: number, computeHours = 0): NeonUsage => ({
  transferBytes: transferGb * GB,
  computeSeconds: computeHours * HOUR,
  periodStart,
  periodEnd,
});
const levels = (u: NeonUsage, now: Date) =>
  evaluateQuota(u, now).map((a) => `${a.metric}:${a.level}`);

describe("evaluateQuota", () => {
  it("stays quiet under every threshold", () => {
    expect(levels(usage(1, 10), day(20))).toEqual([]);
  });

  it("reports the highest threshold per metric", () => {
    expect(levels(usage(3.5, 95), day(28))).toEqual(["transfer:70", "compute:90"]);
    expect(levels(usage(4.6), day(29))).toEqual(["transfer:90"]);
  });

  it("warns on a projection over the limit, but not on the first days", () => {
    expect(levels(usage(2), day(10))).toEqual(["transfer:pace"]);
    expect(levels(usage(2), day(3))).toEqual([]);
    expect(levels(usage(1), day(6))).toEqual([]); // 20%: too little to project from
  });
});

describe("usageFromProject", () => {
  const raw = {
    data_transfer_bytes: 1,
    compute_time_seconds: 2,
    consumption_period_start: "2026-11-01T00:00:00Z",
    consumption_period_end: "2026-12-01T00:00:00Z",
  };

  it("uses Neon's period", () => {
    expect(usageFromProject(raw, day(10)).periodEnd).toEqual(periodEnd);
  });

  it("falls back to the calendar month on a zero or stale period", () => {
    const out = usageFromProject(
      {
        ...raw,
        consumption_period_start: "0001-01-01T00:00:00Z",
        consumption_period_end: "0001-01-01T00:00:00Z",
      },
      new Date("2026-11-24T12:00:00Z"),
    );
    expect(out.periodStart).toEqual(periodStart);
    expect(out.periodEnd).toEqual(periodEnd);
  });
});

describe("buildQuotaMessage", () => {
  it("says how much, how fast and when it resets", () => {
    const u = usage(4.25);
    const now = day(18);
    expect(buildQuotaMessage(evaluateQuota(u, now), u, now)).toBe(
      [
        "⚠️ **Neon usage** · day 18 of 30, resets Dec 1",
        "🟠 **Network transfer:** 85% (4.25 GB of 5.00 GB), on pace for 7.50 GB",
        "Neon suspends the database at the limit: docs/discord-bot-runbook.md",
      ].join("\n"),
    );
  });
});

describe("neon quota job", () => {
  let client: PGlite;
  let db: DbClient;
  const notify = vi.fn(async (_content: string) => true);

  const api = (transferGb: number, computeHours = 0) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            project: {
              data_transfer_bytes: transferGb * GB,
              compute_time_seconds: computeHours * HOUR,
              consumption_period_start: periodStart.toISOString(),
              consumption_period_end: periodEnd.toISOString(),
            },
          }),
        ),
    ) as unknown as typeof fetch;
  const run = (fetcher: typeof fetch, now: Date, send = notify) =>
    runNeonQuotaJob({
      now,
      db,
      fetcher,
      notify: send,
      projectId: "test-project",
      apiUrl: "http://neon.invalid",
      readApiKey: async () => "key",
    });

  beforeAll(async () => {
    process.env.STAGE = "local";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SESSION_SECRET = "x".repeat(32);
    process.env.LOG_LEVEL = "error";
    resetConfigForTesting();
    client = new PGlite();
    const testDb = drizzle(client);
    await migrate(testDb, { migrationsFolder: "./drizzle" });
    db = testDb as unknown as DbClient;
  }, 60_000);

  beforeEach(async () => {
    notify.mockClear();
    await client.query("DELETE FROM ops_alert_marks");
  });

  it("degrades cleanly with no key", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const out = await runNeonQuotaJob({
      db,
      fetcher,
      notify,
      projectId: "p",
      readApiKey: async () => null,
    });
    expect(out).toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("pings each threshold once a period", async () => {
    expect(await run(api(3.6), day(25))).toEqual({ status: "alerted", alerts: 1 });
    expect(await run(api(3.7), day(26))).toEqual({ status: "ok", alerts: 0 });
    expect(await run(api(4.6), day(28))).toEqual({ status: "alerted", alerts: 1 });
    expect(await run(api(4.7), day(29))).toEqual({ status: "ok", alerts: 0 });
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not step back down after a higher threshold", async () => {
    await run(api(4.6), day(28));
    notify.mockClear();
    expect(await run(api(3.6), day(29))).toEqual({ status: "ok", alerts: 0 });
    expect(notify).not.toHaveBeenCalled();
  });

  it("starts over in a new period", async () => {
    await run(api(3.6), day(25));
    notify.mockClear();
    const next = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            project: {
              data_transfer_bytes: 3.6 * GB,
              compute_time_seconds: 0,
              consumption_period_start: "2026-12-01T00:00:00Z",
              consumption_period_end: "2027-01-01T00:00:00Z",
            },
          }),
        ),
    ) as unknown as typeof fetch;
    expect(await run(next, new Date("2026-12-25T00:00:00Z"))).toMatchObject({ status: "alerted" });
  });

  it("retries tomorrow when Discord didn't take the alert", async () => {
    const dropped = vi.fn(async (_content: string) => false);
    expect(await run(api(3.6), day(25), dropped)).toEqual({ status: "undelivered", alerts: 1 });
    expect(await run(api(3.6), day(26))).toEqual({ status: "alerted", alerts: 1 });
  });

  it("does not touch the database on a quiet day", async () => {
    const untouched = new Proxy({} as DbClient, {
      get() {
        throw new Error("database touched");
      },
    });
    const out = await runNeonQuotaJob({
      now: day(10),
      db: untouched,
      fetcher: api(0.5),
      notify,
      projectId: "p",
      apiUrl: "http://neon.invalid",
      readApiKey: async () => "key",
    });
    expect(out).toEqual({ status: "ok", alerts: 0 });
  });

  it("fails loudly on a bad API answer", async () => {
    const denied = vi.fn(
      async () => new Response("nope", { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(run(denied, day(10))).rejects.toThrow("Neon API answered 401");
  });
});
