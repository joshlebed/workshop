import type { BookResult, MediaResult, MediaSearchType } from "@workshop/shared";
import { Hono } from "hono";
import { z } from "zod";
import { getConfig } from "../../lib/config.js";
import { logger } from "../../lib/logger.js";
import { CacheTtl, lookupCacheEntry, upsertCacheEntry } from "../../lib/metadata-cache.js";
import { err, ok } from "../../lib/response.js";
import { requireAuth } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";

export const searchRoutes = new Hono();

searchRoutes.use("*", requireAuth);

// Per-user rate limit on search routes (auth-only). 60/min/user is generous
// for typed-as-you-go UIs; the client also debounces input by 300ms.
const userKey = (c: Parameters<Parameters<typeof searchRoutes.use>[1]>[0]): string | null =>
  c.get("userId") ?? null;

const querySchema = z.object({
  q: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "q required").max(200, "q too long")),
});

const mediaTypeSchema = z.union([z.literal("movie"), z.literal("tv")]);

// Cache key for a query is `q-search:<normalized-query>`. Normalized = trimmed
// + lowercased — the same input wrapped in different whitespace shouldn't
// re-hit the provider.
function searchCacheKey(q: string): string {
  return `q-search:${q.trim().toLowerCase()}`;
}

interface DepsForTesting {
  fetchTmdb?: typeof fetchTmdbSearch;
  fetchGoogleBooks?: typeof fetchGoogleBooksSearch;
  /** Mock cache lookup. Tests pass `() => null` to skip DB. */
  lookupCache?: <T>(source: string, sourceId: string) => Promise<{ data: T } | null>;
  /** Mock cache upsert. Tests pass `() => undefined` to skip DB. */
  upsertCache?: (source: string, sourceId: string, data: unknown, ttl: number) => Promise<void>;
}

let testDeps: DepsForTesting = {};
export const __testing = {
  setDeps(d: DepsForTesting) {
    testDeps = d;
  },
  reset() {
    testDeps = {};
  },
};

async function lookup<T>(source: string, sourceId: string): Promise<{ data: T } | null> {
  if (testDeps.lookupCache) return testDeps.lookupCache<T>(source, sourceId);
  const r = await lookupCacheEntry<T>(source, sourceId).catch(() => null);
  return r ? { data: r.data } : null;
}

async function upsert(source: string, sourceId: string, data: unknown, ttl: number): Promise<void> {
  if (testDeps.upsertCache) {
    await testDeps.upsertCache(source, sourceId, data, ttl);
    return;
  }
  await upsertCacheEntry(source, sourceId, data, ttl);
}

// --- TMDB ---

interface TmdbSearchResponse {
  results?: Array<{
    id?: number;
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
    poster_path?: string | null;
    overview?: string;
    runtime?: number;
    episode_run_time?: number[];
  }>;
}

const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w500";

async function fetchTmdbSearch(
  type: MediaSearchType,
  q: string,
  apiKey: string,
): Promise<MediaResult[]> {
  const url = new URL(`https://api.themoviedb.org/3/search/${type}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", q);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-US");
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`tmdb upstream ${res.status}`);
  }
  const json = (await res.json()) as TmdbSearchResponse;
  const rows = json.results ?? [];
  return rows.slice(0, 20).map((r) => normalizeTmdbRow(r, type));
}

function normalizeTmdbRow(
  r: NonNullable<TmdbSearchResponse["results"]>[number],
  type: MediaSearchType,
): MediaResult {
  const title = type === "movie" ? r.title : r.name;
  const dateStr = type === "movie" ? r.release_date : r.first_air_date;
  const year = dateStr && /^\d{4}/.test(dateStr) ? Number(dateStr.slice(0, 4)) : null;
  const posterUrl = r.poster_path ? `${TMDB_POSTER_BASE}${r.poster_path}` : null;
  const result: MediaResult = {
    id: String(r.id ?? ""),
    title: title ?? "",
    year,
    posterUrl,
    overview: r.overview && r.overview.length > 0 ? r.overview : null,
  };
  // TMDB search hits don't include runtime — only the per-id detail does.
  // Tests can still assert the field is omitted; clients refetch by id later.
  if (typeof r.runtime === "number") result.runtimeMinutes = r.runtime;
  else if (Array.isArray(r.episode_run_time) && typeof r.episode_run_time[0] === "number") {
    result.runtimeMinutes = r.episode_run_time[0];
  }
  return result;
}

searchRoutes.get(
  "/media",
  rateLimit({ family: "v1.search.media", limit: 60, windowSec: 60, key: userKey }),
  async (c) => {
    const typeParsed = mediaTypeSchema.safeParse(c.req.query("type"));
    if (!typeParsed.success) {
      return err(c, "VALIDATION", "type must be 'movie' or 'tv'");
    }
    const queryParsed = querySchema.safeParse({ q: c.req.query("q") ?? "" });
    if (!queryParsed.success) {
      return err(c, "VALIDATION", "invalid query", queryParsed.error.issues);
    }
    const apiKey = getConfig().tmdbApiKey;
    if (!apiKey) {
      return err(c, "INTERNAL", "tmdb api key not configured");
    }

    const type = typeParsed.data;
    const q = queryParsed.data.q;
    const cacheSource = `tmdb:${type}`;
    const cacheKey = searchCacheKey(q);

    const cached = await lookup<MediaResult[]>(cacheSource, cacheKey);
    if (cached) {
      return ok(c, { results: cached.data });
    }

    let results: MediaResult[];
    try {
      results = await (testDeps.fetchTmdb ?? fetchTmdbSearch)(type, q, apiKey);
    } catch (error) {
      logger.error("tmdb search failed", { error, type, q });
      return err(c, "INTERNAL", "search provider failed");
    }

    // Best-effort cache write — never block the response on a cache miss path.
    upsert(cacheSource, cacheKey, results, CacheTtl.tmdb).catch((error) => {
      logger.warn("metadata cache write failed", { error, cacheSource });
    });

    return ok(c, { results });
  },
);

// --- Google Books ---

interface GoogleBooksResponse {
  items?: Array<{
    id?: string;
    volumeInfo?: {
      title?: string;
      authors?: string[];
      publishedDate?: string;
      pageCount?: number;
      description?: string;
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }>;
}

async function fetchGoogleBooksSearch(q: string, apiKey: string): Promise<BookResult[]> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", "20");
  url.searchParams.set("printType", "books");
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`google books upstream ${res.status}`);
  }
  const json = (await res.json()) as GoogleBooksResponse;
  const rows = json.items ?? [];
  return rows.map(normalizeGoogleBooksRow);
}

function normalizeGoogleBooksRow(r: NonNullable<GoogleBooksResponse["items"]>[number]): BookResult {
  const v = r.volumeInfo ?? {};
  const dateStr = v.publishedDate;
  const year = dateStr && /^\d{4}/.test(dateStr) ? Number(dateStr.slice(0, 4)) : null;
  // Prefer thumbnail; fall back to smallThumbnail. Force HTTPS — Google Books
  // sometimes serves these as `http://`.
  const rawCover = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? null;
  const coverUrl = rawCover ? rawCover.replace(/^http:\/\//, "https://") : null;
  const result: BookResult = {
    id: String(r.id ?? ""),
    title: v.title ?? "",
    authors: Array.isArray(v.authors) ? v.authors : [],
    year,
    coverUrl,
  };
  if (typeof v.pageCount === "number") result.pageCount = v.pageCount;
  if (typeof v.description === "string" && v.description.length > 0) {
    result.description = v.description;
  }
  return result;
}

searchRoutes.get(
  "/books",
  rateLimit({ family: "v1.search.books", limit: 60, windowSec: 60, key: userKey }),
  async (c) => {
    const queryParsed = querySchema.safeParse({ q: c.req.query("q") ?? "" });
    if (!queryParsed.success) {
      return err(c, "VALIDATION", "invalid query", queryParsed.error.issues);
    }
    const apiKey = getConfig().googleBooksApiKey;
    if (!apiKey) {
      return err(c, "INTERNAL", "google books api key not configured");
    }

    const q = queryParsed.data.q;
    const cacheSource = "google_books:search";
    const cacheKey = searchCacheKey(q);

    const cached = await lookup<BookResult[]>(cacheSource, cacheKey);
    if (cached) {
      return ok(c, { results: cached.data });
    }

    let results: BookResult[];
    try {
      results = await (testDeps.fetchGoogleBooks ?? fetchGoogleBooksSearch)(q, apiKey);
    } catch (error) {
      logger.error("google books search failed", { error, q });
      return err(c, "INTERNAL", "search provider failed");
    }

    upsert(cacheSource, cacheKey, results, CacheTtl.googleBooks).catch((error) => {
      logger.warn("metadata cache write failed", { error, cacheSource });
    });

    return ok(c, { results });
  },
);

export const __internal = {
  normalizeTmdbRow,
  normalizeGoogleBooksRow,
};
