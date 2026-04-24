import { sql } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { getDb } from "../db/client.js";
import { rateLimits } from "../db/schema.js";
import { err } from "../lib/response.js";

export type RateLimitKeyFn = (c: Parameters<MiddlewareHandler>[0]) => string | null;

export interface RateLimitOptions {
  /** Stable identifier for the route family — combined with the per-request key. */
  family: string;
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Returns the per-request bucket discriminator (user id, IP, etc.). */
  key: RateLimitKeyFn;
}

interface DbLike {
  execute: (q: ReturnType<typeof sql>) => Promise<unknown>;
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
export async function consume(db: DbLike, bucketKey: string, windowStartTs: Date): Promise<number> {
  const rows = (await db.execute(sql`
    INSERT INTO ${rateLimits} (bucket_key, window_start, count)
    VALUES (${bucketKey}, ${windowStartTs.toISOString()}, 1)
    ON CONFLICT (bucket_key, window_start)
    DO UPDATE SET count = ${rateLimits}.count + 1
    RETURNING count
  `)) as { count: number }[] | { rows: { count: number }[] };

  const list = Array.isArray(rows) ? rows : rows.rows;
  const row = list[0];
  if (!row) throw new Error("rate-limit insert returned no row");
  return row.count;
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
