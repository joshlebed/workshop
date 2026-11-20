import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { getDb } from "../db/client.js";
import { rateLimits } from "../db/schema.js";
import { err } from "../lib/response.js";
import { executeRows, type SqlExecutor } from "../lib/sql.js";

type RateLimitKeyFn = (c: Parameters<MiddlewareHandler>[0]) => string | null;

interface RateLimitOptions {
  /** Stable identifier for the route family — combined with the per-request key. */
  family: string;
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Returns the per-request bucket discriminator (user id, IP, etc.). */
  key: RateLimitKeyFn;
}

function windowStart(now: Date, windowSec: number): Date {
  const epochSec = Math.floor(now.getTime() / 1000);
  const bucketSec = epochSec - (epochSec % windowSec);
  return new Date(bucketSec * 1000);
}

/**
 * Fixed-window counter against the `rate_limits` table. Returns the post-increment
 * count. Concurrent callers race-safely via the unique PK (bucket_key, window_start).
 */
export async function consume(
  db: SqlExecutor,
  bucketKey: string,
  windowStartTs: Date,
): Promise<number> {
  const rows = await executeRows<{ count: number }>(
    db,
    sql`
      INSERT INTO ${rateLimits} (bucket_key, window_start, count)
      VALUES (${bucketKey}, ${windowStartTs.toISOString()}, 1)
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET count = ${rateLimits}.count + 1
      RETURNING count
    `,
  );
  const row = rows[0];
  if (!row) throw new Error("rate-limit insert returned no row");
  return row.count;
}

/** Longer than the longest window (one day), so a live counter is never removed. */
const PRUNE_AFTER_DAYS = 2;

/**
 * Deletes counters whose window is long over. Nothing reads them again, and
 * without this the table kept every (rule, caller, minute) since launch. Run
 * from the hourly job, when the database is awake anyway.
 */
export async function pruneExpiredRateLimits(db: SqlExecutor = getDb()): Promise<number> {
  const rows = await executeRows<{ n: number }>(
    db,
    sql`
      WITH gone AS (
        DELETE FROM ${rateLimits}
        WHERE window_start < now() - make_interval(days => ${PRUNE_AFTER_DAYS})
        RETURNING 1
      )
      SELECT count(*)::int AS n FROM gone
    `,
  );
  return rows[0]?.n ?? 0;
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const discriminator = opts.key(c);
    if (discriminator === null) return next();

    const bucketKey = `${opts.family}:${discriminator}`;
    const start = windowStart(new Date(), opts.windowSec);

    let count: number;
    try {
      count = await consume(getDb(), bucketKey, start);
    } catch {
      // Fail-open: a rate-limiter outage shouldn't take the API down.
      return next();
    }

    if (count > opts.limit) {
      return err(c, "RATE_LIMITED", "rate limit exceeded", {
        family: opts.family,
        limit: opts.limit,
        windowSec: opts.windowSec,
      });
    }
    return next();
  };
}

export const __testing = { windowStart };
