// Per-user Letterboxd watchlist scrape + cache (Letterboxd-match lists).
//
// Unlike `letterboxdList.ts` (one public list → one Workshop list), this
// module syncs a *user's* watchlist into the account-level
// `letterboxd_watchlist_films` cache. Match lists never read Letterboxd
// directly — they join their members' caches by film slug, so the expensive
// scrape happens at most once per user per staleness window regardless of
// how many lists share that member.
//
// Net surface:
//   - `normalizeLetterboxdUsername(input)` → username | InvalidLetterboxdUsernameError
//   - `parseLetterboxdFilmUrl(input)` → { slug, url } | InvalidLetterboxdUrlError
//   - `fetchWatchlistFilms(username, deps?)` → { films, pageCount, truncated }
//   - `fetchFilmInfo(slug, deps?)` → { title, year } (best-effort, never throws)
//   - `syncUserWatchlist({ userId, username, db, deps? })` → { filmCount, truncated }

import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { DbClient } from "../sql.js";
import {
  type Fetcher,
  fetchListHtml,
  InvalidLetterboxdUrlError,
  parseLetterboxdListHtml,
  type ScrapedFilm,
} from "./letterboxdList.js";

export class InvalidLetterboxdUsernameError extends Error {
  constructor(message = "invalid Letterboxd username") {
    super(message);
    this.name = "InvalidLetterboxdUsernameError";
  }
}

// Letterboxd usernames: 2–15 chars, letters/digits/underscore (the site also
// grandfathered some dashes — accept them). Case-insensitive in URLs, so we
// normalize to lowercase.
const USERNAME_RE = /^[a-z0-9_-]{2,32}$/;

/**
 * Accepts a bare username ("davidlynch"), an @-prefixed one, or any
 * letterboxd.com profile/watchlist URL, and returns the canonical lowercase
 * username.
 */
export function normalizeLetterboxdUsername(input: string): string {
  let candidate = input.trim();
  if (candidate.startsWith("@")) candidate = candidate.slice(1);
  if (/^https?:\/\//i.test(candidate) || /^(www\.)?letterboxd\.com\//i.test(candidate)) {
    const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw new InvalidLetterboxdUsernameError();
    }
    if (url.hostname !== "letterboxd.com" && url.hostname !== "www.letterboxd.com") {
      throw new InvalidLetterboxdUsernameError();
    }
    const [first] = url.pathname.replace(/^\/+/, "").split("/");
    candidate = first ?? "";
  }
  candidate = candidate.toLowerCase();
  if (!USERNAME_RE.test(candidate)) throw new InvalidLetterboxdUsernameError();
  return candidate;
}

/** `letterboxd.com/film/<slug>/` → canonical slug + URL. */
export function parseLetterboxdFilmUrl(input: string): { slug: string; url: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidLetterboxdUrlError("invalid Letterboxd film URL");
  }
  if (url.hostname !== "letterboxd.com" && url.hostname !== "www.letterboxd.com") {
    throw new InvalidLetterboxdUrlError("invalid Letterboxd film URL");
  }
  const parts = url.pathname.replace(/^\/|\/$/g, "").split("/");
  // Both `/film/<slug>/` and `/<user>/film/<slug>/` (a user's logged review
  // context) identify the same film.
  const filmIdx = parts.indexOf("film");
  const slug = filmIdx >= 0 ? parts[filmIdx + 1] : undefined;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    throw new InvalidLetterboxdUrlError("invalid Letterboxd film URL");
  }
  return { slug: slug.toLowerCase(), url: `https://letterboxd.com/film/${slug.toLowerCase()}/` };
}

export function watchlistUrl(username: string, page: number): string {
  return page <= 1
    ? `https://letterboxd.com/${username}/watchlist/`
    : `https://letterboxd.com/${username}/watchlist/page/${page}/`;
}

/**
 * Max page number linked from a watchlist page's pagination block. Letterboxd
 * renders `…/watchlist/page/N/` anchors for the visible page range plus the
 * last page, so the max over all matches is the page count. No matches = a
 * single page.
 */
export function parseWatchlistPageCount(html: string): number {
  const re = /\/watchlist\/page\/(\d{1,4})\//g;
  let max = 1;
  let m = re.exec(html);
  while (m !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
    m = re.exec(html);
  }
  return max;
}

interface WatchlistDeps {
  fetcher?: Fetcher;
  /** Page-fetch cap per sync — keeps a huge watchlist inside the Lambda budget. */
  maxPages?: number;
}

/**
 * Watchlists run 28 films per page; 36 pages ≈ 1000 films, comfortably past
 * the typical watchlist while keeping the worst case bounded (~36 fetches).
 */
const DEFAULT_MAX_PAGES = 36;
const PAGE_FETCH_CONCURRENCY = 4;

interface WatchlistFetchResult {
  films: ScrapedFilm[];
  pageCount: number;
  /** True when the watchlist had more pages than the cap allowed us to read. */
  truncated: boolean;
}

export async function fetchWatchlistFilms(
  username: string,
  deps: WatchlistDeps = {},
): Promise<WatchlistFetchResult> {
  const fetcher = deps.fetcher ?? fetch;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;

  const firstHtml = await fetchListHtml(watchlistUrl(username, 1), fetcher);
  const pageCount = parseWatchlistPageCount(firstHtml);
  const films = parseLetterboxdListHtml(firstHtml);
  const seen = new Set(films.map((f) => f.slug));

  const lastPage = Math.min(pageCount, maxPages);
  const remaining: number[] = [];
  for (let p = 2; p <= lastPage; p++) remaining.push(p);

  // Bounded-concurrency page fetches: chunk the remaining pages so a long
  // watchlist doesn't open dozens of sockets at once.
  for (let i = 0; i < remaining.length; i += PAGE_FETCH_CONCURRENCY) {
    const batch = remaining.slice(i, i + PAGE_FETCH_CONCURRENCY);
    const pages = await Promise.all(
      batch.map((p) => fetchListHtml(watchlistUrl(username, p), fetcher)),
    );
    for (const html of pages) {
      for (const film of parseLetterboxdListHtml(html)) {
        if (seen.has(film.slug)) continue;
        seen.add(film.slug);
        films.push(film);
      }
    }
  }

  return { films, pageCount, truncated: pageCount > maxPages };
}

const OG_TITLE_RE = /<meta\s+property="og:title"\s+content="([^"]+)"/;

interface FilmInfo {
  title: string;
  year: number | null;
}

/**
 * Best-effort title/year for a single film page (suggestion flow). Falls
 * back to a humanized slug when the page can't be read — the TMDB enrichment
 * downstream is also best-effort, so this never blocks a suggestion.
 */
export async function fetchFilmInfo(slug: string, deps: WatchlistDeps = {}): Promise<FilmInfo> {
  const fallback: FilmInfo = {
    title: slug
      .split("-")
      .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
      .join(" "),
    year: null,
  };
  try {
    const html = await fetchListHtml(`https://letterboxd.com/film/${slug}/`, deps.fetcher ?? fetch);
    const og = html.match(OG_TITLE_RE)?.[1];
    if (!og) return fallback;
    const m = og.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    if (m?.[1] && m[2]) return { title: m[1].trim(), year: Number(m[2]) };
    return { title: og.trim(), year: null };
  } catch (error) {
    logger.warn("letterboxd film info fetch failed", { slug, error });
    return fallback;
  }
}

/**
 * Re-scrape one user's watchlist and replace their cache rows wholesale.
 * Caller owns staleness policy; this always does the full fetch.
 */
export async function syncUserWatchlist(args: {
  userId: string;
  username: string;
  db: DbClient;
  deps?: WatchlistDeps;
}): Promise<{ filmCount: number; truncated: boolean }> {
  const { films, truncated } = await fetchWatchlistFilms(args.username, args.deps);
  const syncedAt = new Date();

  // Replace wholesale: films removed from the watchlist drop out of the
  // cache, which is exactly what powers the read-time "no longer in common"
  // flag — items already in a list are never archived by this.
  await args.db.execute(sql`DELETE FROM letterboxd_watchlist_films WHERE user_id = ${args.userId}`);
  const INSERT_CHUNK = 200;
  for (let i = 0; i < films.length; i += INSERT_CHUNK) {
    const chunk = films.slice(i, i + INSERT_CHUNK);
    const values = chunk.map(
      (f) => sql`(${args.userId}, ${f.slug}, ${f.title}, ${f.year}, ${syncedAt})`,
    );
    await args.db.execute(sql`
      INSERT INTO letterboxd_watchlist_films (user_id, film_slug, title, year, synced_at)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT DO NOTHING
    `);
  }
  await args.db.execute(
    sql`UPDATE users SET letterboxd_synced_at = ${syncedAt}, updated_at = now() WHERE id = ${args.userId}`,
  );

  if (truncated) {
    logger.warn("letterboxd watchlist truncated at page cap", {
      userId: args.userId,
      username: args.username,
      filmCount: films.length,
    });
  }
  return { filmCount: films.length, truncated };
}
