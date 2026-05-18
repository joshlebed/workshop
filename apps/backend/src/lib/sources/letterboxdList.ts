// Letterboxd public-list source. The second source kind after Spotify;
// validates that the `list_sources` abstraction isn't accidentally
// Spotify-shaped (spec §3.3, §10 PR-F).
//
// Different from Spotify in three ways:
//   1. No auth — Letterboxd lists are public HTML scrapes.
//   2. Two-step enrichment — the scraped film slug is mapped to its TMDB
//      record so the produced item carries poster/year/runtime in the same
//      `content` shape any other `movie` item would.
//   3. Produces `kind=movie` items, not a new `letterboxd_film` kind. The
//      headline assertion: source kind ≠ item kind.
//
// Net surface:
//   - `parseLetterboxdListUrl(url)` → { username, slug } | InvalidLetterboxdUrlError
//   - `previewLetterboxdList(c, url, deps?)` → { ok: true, config, preview } | { ok: false, response }
//   - `syncLetterboxdListSource({ listId, userId, config, db, deps? })`
//     → { addedCount, refreshedAt }

import { sql } from "drizzle-orm";
import type { Context } from "hono";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import { err } from "../response.js";
import { type DbClient, executeRows } from "../sql.js";
import { assertHostnameSafe, SsrfBlockedError } from "../ssrf-guard.js";

export class InvalidLetterboxdUrlError extends Error {
  constructor(message = "invalid Letterboxd list URL") {
    super(message);
    this.name = "InvalidLetterboxdUrlError";
  }
}

export class LetterboxdScrapeError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "LetterboxdScrapeError";
    this.status = status;
  }
}

class TmdbEnrichmentError extends Error {
  constructor(message = "tmdb enrichment failed") {
    super(message);
    this.name = "TmdbEnrichmentError";
  }
}

interface LetterboxdListConfig {
  letterboxdUrl: string;
  letterboxdUsername: string;
  letterboxdListSlug: string;
}

interface LetterboxdListPreview {
  kind: "letterboxd_list";
  username: string;
  slug: string;
  filmCount: number;
}

// Letterboxd URL shape:
//   https://letterboxd.com/<username>/list/<slug>/
//   https://letterboxd.com/<username>/watchlist/    (watchlist alias)
// Both feed the same scrape path; the "watchlist" form is normalized to
// `slug='watchlist'`.
export function parseLetterboxdListUrl(input: string): {
  username: string;
  slug: string;
  url: string;
} {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidLetterboxdUrlError();
  }
  if (url.hostname !== "letterboxd.com" && url.hostname !== "www.letterboxd.com") {
    throw new InvalidLetterboxdUrlError();
  }
  const parts = url.pathname.replace(/^\/|\/$/g, "").split("/");
  if (parts.length < 2 || !parts[0]) throw new InvalidLetterboxdUrlError();
  const username = parts[0];
  // `letterboxd.com/<user>/watchlist/`
  if (parts.length === 2 && parts[1] === "watchlist") {
    return {
      username,
      slug: "watchlist",
      url: `https://letterboxd.com/${username}/watchlist/`,
    };
  }
  // `letterboxd.com/<user>/list/<slug>/`
  if (parts.length >= 3 && parts[1] === "list" && parts[2]) {
    const slug = parts[2];
    return {
      username,
      slug,
      url: `https://letterboxd.com/${username}/list/${slug}/`,
    };
  }
  throw new InvalidLetterboxdUrlError();
}

// --- Scrape ---
//
// Letterboxd doesn't publish a public API, but every list page emits a
// per-film poster block whose `data-film-slug` + `data-film-name` + the
// detail link to `/film/<slug>/` are stable. We parse those via a small
// regex pass; we deliberately don't pull in a full HTML parser since the
// extraction is narrow.

export interface ScrapedFilm {
  slug: string;
  /** Display title as Letterboxd surfaces it on the list page. */
  title: string | null;
  /** Optional release year, when surfaced in the list page. */
  year: number | null;
  /** Canonical Letterboxd URL for the film (for dedup + provenance). */
  letterboxdUrl: string;
}

const LETTERBOXD_FILM_BLOCK_RE =
  /<li[^>]*class="[^"]*poster-container[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
const LETTERBOXD_FILM_SLUG_RE = /data-film-slug="([^"]+)"/;
const LETTERBOXD_FILM_NAME_RE = /data-film-name="([^"]+)"/;
const LETTERBOXD_FILM_YEAR_RE = /data-film-release-year="(\d{4})"/;
// `frame-title` is the in-page anchor — release year is sometimes inside the
// link text instead of the data attribute (older list pages).
const LETTERBOXD_FILM_FRAME_YEAR_RE = /\((\d{4})\)/;

export function parseLetterboxdListHtml(html: string): ScrapedFilm[] {
  const out: ScrapedFilm[] = [];
  const seen = new Set<string>();
  // Use a fresh local RegExp so `lastIndex` doesn't leak across calls and so
  // `continue` paths don't desync. The module-level constant is the pattern;
  // the local copy owns the iteration state.
  const blockRe = new RegExp(LETTERBOXD_FILM_BLOCK_RE.source, LETTERBOXD_FILM_BLOCK_RE.flags);
  let match = blockRe.exec(html);
  while (match !== null) {
    const block = match[1] ?? "";
    const next = blockRe.exec(html);
    const slug = block.match(LETTERBOXD_FILM_SLUG_RE)?.[1];
    if (!slug || seen.has(slug)) {
      match = next;
      continue;
    }
    const title = block.match(LETTERBOXD_FILM_NAME_RE)?.[1] ?? null;
    const yearAttr = block.match(LETTERBOXD_FILM_YEAR_RE)?.[1];
    const yearFrame = block.match(LETTERBOXD_FILM_FRAME_YEAR_RE)?.[1];
    const year =
      yearAttr && /^\d{4}$/.test(yearAttr)
        ? Number(yearAttr)
        : yearFrame && /^\d{4}$/.test(yearFrame)
          ? Number(yearFrame)
          : null;
    seen.add(slug);
    out.push({
      slug,
      title,
      year,
      letterboxdUrl: `https://letterboxd.com/film/${slug}/`,
    });
    match = next;
  }
  return out;
}

// --- TMDB lookup ---
//
// Letterboxd film slug → TMDB movie record. Two strategies: (a) the
// `/find` endpoint with an IMDB id when the slug carries one (rare in the
// public scrape); (b) `/search/movie?query=<title>&year=<year>` and pick
// the first hit. We use (b) since the scrape gives us title + year.

export interface TmdbMovieRecord {
  tmdbId: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  runtimeMinutes: number | null;
  overview: string | null;
}

interface TmdbSearchResponse {
  results?: Array<{
    id?: number;
    title?: string;
    release_date?: string;
    poster_path?: string | null;
    overview?: string;
    runtime?: number;
  }>;
}

const TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w500";

type Fetcher = typeof fetch;

async function searchTmdbMovie(
  query: string,
  year: number | null,
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<TmdbMovieRecord | null> {
  const url = new URL("https://api.themoviedb.org/3/search/movie");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", query);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-US");
  if (year !== null) url.searchParams.set("year", String(year));
  const res = await fetcher(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new TmdbEnrichmentError(`tmdb upstream ${res.status}`);
  const json = (await res.json()) as TmdbSearchResponse;
  const first = (json.results ?? [])[0];
  if (!first?.id) return null;
  const dateStr = first.release_date;
  const parsedYear = dateStr && /^\d{4}/.test(dateStr) ? Number(dateStr.slice(0, 4)) : null;
  return {
    tmdbId: String(first.id),
    title: first.title ?? query,
    year: parsedYear,
    posterUrl: first.poster_path ? `${TMDB_POSTER_BASE}${first.poster_path}` : null,
    runtimeMinutes: typeof first.runtime === "number" ? first.runtime : null,
    overview: first.overview && first.overview.length > 0 ? first.overview : null,
  };
}

// --- Scrape wire ---

async function fetchListHtml(url: string, fetcher: Fetcher = fetch): Promise<string> {
  const parsed = new URL(url);
  // SSRF guard: even though we limit to letterboxd.com, the URL still resolves
  // through DNS and we don't want a poisoned record to hand us a private IP.
  try {
    await assertHostnameSafe(parsed.hostname);
  } catch (e) {
    if (e instanceof SsrfBlockedError) throw new LetterboxdScrapeError(e.message);
    throw e;
  }
  const res = await fetcher(parsed.toString(), {
    method: "GET",
    headers: {
      // Letterboxd serves a lightweight HTML for default UAs. A browser-like UA
      // gets us the same payload without anything that needs JS to render.
      "User-Agent": "workshop-bot/1.0 (+https://workshop.josh.dev)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(10_000),
    redirect: "follow",
  });
  if (res.status === 404) {
    throw new LetterboxdScrapeError("list not found", 404);
  }
  if (res.status === 403) {
    throw new LetterboxdScrapeError("list is private", 403);
  }
  if (!res.ok) {
    throw new LetterboxdScrapeError(`upstream ${res.status}`, res.status);
  }
  return res.text();
}

// --- Preview ---

interface PreviewDeps {
  fetcher?: Fetcher;
}

export async function previewLetterboxdList(
  c: Context,
  url: string,
  deps: PreviewDeps = {},
): Promise<
  | { ok: true; config: LetterboxdListConfig; preview: LetterboxdListPreview }
  | { ok: false; response: Response }
> {
  let parsed: { username: string; slug: string; url: string };
  try {
    parsed = parseLetterboxdListUrl(url);
  } catch (e) {
    if (e instanceof InvalidLetterboxdUrlError) {
      return {
        ok: false,
        response: err(c, "VALIDATION", "invalid letterboxd list URL", {
          code: "INVALID_LETTERBOXD_URL",
        }),
      };
    }
    throw e;
  }

  let html: string;
  try {
    html = await fetchListHtml(parsed.url, deps.fetcher);
  } catch (e) {
    if (e instanceof LetterboxdScrapeError) {
      const code =
        e.status === 404
          ? "LIST_NOT_FOUND"
          : e.status === 403
            ? "LIST_NOT_AVAILABLE"
            : "LIST_FETCH_FAILED";
      logger.warn("letterboxd scrape failed", { url: parsed.url, status: e.status });
      return {
        ok: false,
        response: err(c, "VALIDATION", "list is private or unavailable", { code }),
      };
    }
    throw e;
  }

  const films = parseLetterboxdListHtml(html);
  return {
    ok: true,
    config: {
      letterboxdUrl: parsed.url,
      letterboxdUsername: parsed.username,
      letterboxdListSlug: parsed.slug,
    },
    preview: {
      kind: "letterboxd_list",
      username: parsed.username,
      slug: parsed.slug,
      filmCount: films.length,
    },
  };
}

// --- Sync ---

interface SyncDeps {
  fetcher?: Fetcher;
  /** Inject for tests; defaults to the real TMDB search hit. */
  enrich?: (slug: string, scraped: ScrapedFilm) => Promise<TmdbMovieRecord | null>;
}

export async function syncLetterboxdListSource(args: {
  listId: string;
  userId: string;
  config: LetterboxdListConfig;
  db: DbClient;
  deps?: SyncDeps;
}): Promise<{ addedCount: number; refreshedAt: Date }> {
  const deps = args.deps ?? {};
  const fetcher: Fetcher = deps.fetcher ?? fetch;
  const html = await fetchListHtml(args.config.letterboxdUrl, fetcher);
  const films = parseLetterboxdListHtml(html);
  const refreshedAt = new Date();

  const enrich =
    deps.enrich ??
    (async (_slug: string, scraped: ScrapedFilm): Promise<TmdbMovieRecord | null> => {
      const apiKey = getConfig().tmdbApiKey;
      if (!apiKey) {
        // No TMDB key — fall back to scraped data without enrichment. The item
        // still lands as `kind=movie`; the poster/runtime/overview just stay null.
        return null;
      }
      if (!scraped.title) return null;
      try {
        return await searchTmdbMovie(scraped.title, scraped.year, apiKey, fetcher);
      } catch (e) {
        logger.warn("tmdb enrich failed", { slug: scraped.slug, error: e });
        return null;
      }
    });

  let addedCount = 0;
  for (const film of films) {
    const enriched = await enrich(film.slug, film);
    addedCount += await insertFilmIfMissing({
      listId: args.listId,
      userId: args.userId,
      scraped: film,
      enriched,
      detectedAt: refreshedAt,
      db: args.db,
    });
  }
  return { addedCount, refreshedAt };
}

async function insertFilmIfMissing(args: {
  listId: string;
  userId: string;
  scraped: ScrapedFilm;
  enriched: TmdbMovieRecord | null;
  detectedAt: Date;
  db: DbClient;
}): Promise<number> {
  const { scraped, enriched } = args;
  const content: Record<string, unknown> = {
    source: enriched ? "tmdb" : "letterboxd",
    letterboxdUrl: scraped.letterboxdUrl,
  };
  if (enriched) {
    content.sourceId = enriched.tmdbId;
    content.tmdbId = enriched.tmdbId;
    if (enriched.posterUrl) content.posterUrl = enriched.posterUrl;
    if (enriched.year !== null) content.year = enriched.year;
    else if (scraped.year !== null) content.year = scraped.year;
    if (enriched.runtimeMinutes !== null) content.runtimeMinutes = enriched.runtimeMinutes;
    if (enriched.overview) content.overview = enriched.overview;
  } else {
    if (scraped.year !== null) content.year = scraped.year;
  }

  const title = enriched?.title ?? scraped.title ?? scraped.slug;
  // Dedup uses `(list_id, content->>'tmdbId') WHERE kind='movie' AND content?'tmdbId'`
  // — a partial unique index created by the same migration that drops the
  // legacy columns. Films without a TMDB id can't dedup yet (Letterboxd
  // slugs aren't globally unique across sources); future iterations can add
  // a secondary `letterboxdUrl` index if needed.
  const rows = await executeRows(
    args.db,
    sql`
      INSERT INTO items (list_id, kind, title, url, content, added_by, position)
      VALUES (
        ${args.listId},
        'movie',
        ${title},
        ${scraped.letterboxdUrl},
        ${JSON.stringify(content)}::jsonb,
        ${args.userId},
        NULL
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
  );
  return rows.length;
}
