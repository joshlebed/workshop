import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { consume, pruneExpiredRateLimits } from "./rate-limit.js";

let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  db = drizzle(new PGlite());
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

describe("pruneExpiredRateLimits", () => {
  it("removes counters older than two days and keeps live ones", async () => {
    const now = Date.now();
    const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000);
    await consume(db, "v1.auth:198.51.100.4", at(24 * 30));
    await consume(db, "v1.auth:198.51.100.4", at(49));
    await consume(db, "v1.games.parser.teach.day:u1", at(30)); // a day-long window, still recent
    await consume(db, "v1.auth:198.51.100.4", at(0));

    expect(await pruneExpiredRateLimits(db)).toBe(2);
    expect(await pruneExpiredRateLimits(db)).toBe(0);
    // The live counter keeps counting from where it was.
    expect(await consume(db, "v1.auth:198.51.100.4", at(0))).toBeGreaterThanOrEqual(1);
    const left = await db.execute("select count(*)::int as n from rate_limits");
    expect((left as unknown as { rows: { n: number }[] }).rows[0]?.n).toBe(2);
  });
});
