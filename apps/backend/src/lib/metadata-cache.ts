import { sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { metadataCache } from "../db/schema.js";
import { toDate } from "./dates.js";
import { executeRows, type SqlExecutor } from "./sql.js";

/**
 * Backed by the `metadata_cache` table. Stores normalized provider responses
 * (TMDB search hits, Google Books volumes, link-preview parses) keyed by
 * `(source, source_id)` so per-source clients pick their own id scheme:
 * TMDB uses the numeric id, link-preview hashes the normalized URL, and so on.
 *
 * `expiresAt` is computed at write time from `ttlSeconds` rather than at read
 * time — different sources have different TTLs (TMDB 30d, Google Books 30d,
 * link-preview 7d) and storing the absolute expiry keeps callers from having
 * to know about source-specific TTL knobs at lookup.
 */

interface CacheEntry<T = unknown> {
  source: string;
  sourceId: string;
  data: T;
  fetchedAt: Date;
  expiresAt: Date;
}

/**
 * Returns the entry only if `expires_at > now()`. Expired rows are left in
 * place for the cleanup job (TBD) — pruning here on every read would add
 * write churn to the read path.
 */
export async function lookupCacheEntry<T>(
  source: string,
  sourceId: string,
  db: SqlExecutor = getDb(),
): Promise<CacheEntry<T> | null> {
  const rows = await executeRows<{
    source: string;
    source_id: string;
    data: unknown;
    fetched_at: Date | string;
    expires_at: Date | string;
  }>(
    db,
    sql`
      SELECT source, source_id, data, fetched_at, expires_at
      FROM ${metadataCache}
      WHERE source = ${source}
        AND source_id = ${sourceId}
        AND expires_at > now()
      LIMIT 1
    `,
  );

  const row = rows[0];
  if (!row) return null;
  return {
    source: row.source,
    sourceId: row.source_id,
    data: row.data as T,
    fetchedAt: toDate(row.fetched_at),
    expiresAt: toDate(row.expires_at),
  };
}

/**
 * Upsert by (source, source_id). `ttlSeconds` is added to the current clock
 * to compute `expires_at`; pass a per-source value (TMDB 30 * 86400, etc.).
 */
export async function upsertCacheEntry<T>(
  source: string,
  sourceId: string,
  data: T,
  ttlSeconds: number,
  db: SqlExecutor = getDb(),
): Promise<void> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("ttlSeconds must be a positive finite number");
  }
  await db.execute(sql`
    INSERT INTO ${metadataCache} (source, source_id, data, fetched_at, expires_at)
    VALUES (${source}, ${sourceId}, ${JSON.stringify(data)}::jsonb, now(), now() + (${ttlSeconds}::int * interval '1 second'))
    ON CONFLICT (source, source_id)
    DO UPDATE SET
      data = EXCLUDED.data,
      fetched_at = EXCLUDED.fetched_at,
      expires_at = EXCLUDED.expires_at
  `);
}

export const CacheTtl = {
  /** TMDB search responses + per-id metadata. */
  tmdb: 30 * 24 * 60 * 60,
  /** Google Books volumes. */
  googleBooks: 30 * 24 * 60 * 60,
  /** Link-preview scrapes (Phase 2a-2). */
  linkPreview: 7 * 24 * 60 * 60,
} as const;
