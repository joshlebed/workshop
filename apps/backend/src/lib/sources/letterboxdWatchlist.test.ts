import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../config.js";
import { InvalidLetterboxdUrlError } from "./letterboxdList.js";
import {
  fetchWatchlistFilms,
  InvalidLetterboxdUsernameError,
  normalizeLetterboxdUsername,
  parseLetterboxdFilmUrl,
  parseWatchlistPageCount,
  watchlistUrl,
} from "./letterboxdWatchlist.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();
});

// --- Username normalization ---

describe("normalizeLetterboxdUsername", () => {
  it("accepts a bare username and lowercases it", () => {
    expect(normalizeLetterboxdUsername("DavidLynch")).toBe("davidlynch");
  });

  it("strips an @ prefix", () => {
    expect(normalizeLetterboxdUsername("@dave")).toBe("dave");
  });

  it("extracts the username from a profile URL", () => {
    expect(normalizeLetterboxdUsername("https://letterboxd.com/dave/")).toBe("dave");
  });

  it("extracts the username from a watchlist URL", () => {
    expect(normalizeLetterboxdUsername("https://letterboxd.com/dave/watchlist/")).toBe("dave");
  });

  it("accepts a scheme-less letterboxd.com URL", () => {
    expect(normalizeLetterboxdUsername("letterboxd.com/dave")).toBe("dave");
  });

  it("rejects a non-letterboxd host", () => {
    expect(() => normalizeLetterboxdUsername("https://imdb.com/dave")).toThrow(
      InvalidLetterboxdUsernameError,
    );
  });

  it("rejects whitespace and illegal characters", () => {
    expect(() => normalizeLetterboxdUsername("two words")).toThrow(InvalidLetterboxdUsernameError);
    expect(() => normalizeLetterboxdUsername("d")).toThrow(InvalidLetterboxdUsernameError);
    expect(() => normalizeLetterboxdUsername("")).toThrow(InvalidLetterboxdUsernameError);
  });
});

// --- Film URL parsing ---

describe("parseLetterboxdFilmUrl", () => {
  it("accepts a canonical film URL", () => {
    const r = parseLetterboxdFilmUrl("https://letterboxd.com/film/dune-part-two/");
    expect(r.slug).toBe("dune-part-two");
    expect(r.url).toBe("https://letterboxd.com/film/dune-part-two/");
  });

  it("accepts a user-scoped film URL (logged review context)", () => {
    const r = parseLetterboxdFilmUrl("https://letterboxd.com/dave/film/arrival/");
    expect(r.slug).toBe("arrival");
    expect(r.url).toBe("https://letterboxd.com/film/arrival/");
  });

  it("lowercases the slug", () => {
    expect(parseLetterboxdFilmUrl("https://letterboxd.com/film/DUNE/").slug).toBe("dune");
  });

  it("rejects a list URL", () => {
    expect(() => parseLetterboxdFilmUrl("https://letterboxd.com/dave/list/foo/")).toThrow(
      InvalidLetterboxdUrlError,
    );
  });

  it("rejects a non-letterboxd host", () => {
    expect(() => parseLetterboxdFilmUrl("https://imdb.com/film/dune/")).toThrow(
      InvalidLetterboxdUrlError,
    );
  });
});

// --- Pagination ---

describe("parseWatchlistPageCount", () => {
  it("returns 1 when no pagination block exists", () => {
    expect(parseWatchlistPageCount("<html><body>no pages</body></html>")).toBe(1);
  });

  it("returns the max page from pagination anchors", () => {
    const html = `
      <a href="/dave/watchlist/page/2/">2</a>
      <a href="/dave/watchlist/page/3/">3</a>
      <a href="/dave/watchlist/page/12/">12</a>
    `;
    expect(parseWatchlistPageCount(html)).toBe(12);
  });
});

describe("watchlistUrl", () => {
  it("uses the bare watchlist path for page 1", () => {
    expect(watchlistUrl("dave", 1)).toBe("https://letterboxd.com/dave/watchlist/");
  });
  it("uses /page/N/ beyond page 1", () => {
    expect(watchlistUrl("dave", 3)).toBe("https://letterboxd.com/dave/watchlist/page/3/");
  });
});

// --- Multi-page fetch ---

function pageHtml(slugs: string[], pageCount: number): string {
  const films = slugs
    .map(
      (s) =>
        `<li class="poster-container"><div data-film-slug="${s}" data-film-name="${s}" data-film-release-year="2020"></div></li>`,
    )
    .join("\n");
  const pager =
    pageCount > 1 ? `<a href="/dave/watchlist/page/${pageCount}/">${pageCount}</a>` : "";
  return `<ul>${films}</ul>${pager}`;
}

function makeFetcherByUrl(pages: Record<string, string>) {
  return vi.fn(async (url: unknown) => {
    const body = pages[String(url)];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      text: async () => body ?? "",
    } as Response;
  });
}

describe("fetchWatchlistFilms", () => {
  it("collects films across all pages, deduped by slug", async () => {
    const fetcher = makeFetcherByUrl({
      "https://letterboxd.com/dave/watchlist/": pageHtml(["a", "b"], 3),
      "https://letterboxd.com/dave/watchlist/page/2/": pageHtml(["c", "b"], 3),
      "https://letterboxd.com/dave/watchlist/page/3/": pageHtml(["d"], 3),
    });
    const result = await fetchWatchlistFilms("dave", {
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(result.films.map((f) => f.slug).sort()).toEqual(["a", "b", "c", "d"]);
    expect(result.pageCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("stops at the page cap and flags truncation", async () => {
    const fetcher = makeFetcherByUrl({
      "https://letterboxd.com/dave/watchlist/": pageHtml(["a"], 5),
      "https://letterboxd.com/dave/watchlist/page/2/": pageHtml(["b"], 5),
    });
    const result = await fetchWatchlistFilms("dave", {
      fetcher: fetcher as unknown as typeof fetch,
      maxPages: 2,
    });
    expect(result.films.map((f) => f.slug).sort()).toEqual(["a", "b"]);
    expect(result.truncated).toBe(true);
  });
});
