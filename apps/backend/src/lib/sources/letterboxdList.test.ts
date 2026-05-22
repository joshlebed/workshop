import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../config.js";
import {
  InvalidLetterboxdUrlError,
  LetterboxdScrapeError,
  parseLetterboxdListHtml,
  parseLetterboxdListUrl,
  previewLetterboxdList,
  type ScrapedFilm,
  syncLetterboxdListSource,
  type TmdbMovieRecord,
} from "./letterboxdList.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();
});

// --- URL parsing ---

describe("parseLetterboxdListUrl", () => {
  it("accepts a canonical list URL", () => {
    const r = parseLetterboxdListUrl("https://letterboxd.com/dave/list/best-of-2024/");
    expect(r.username).toBe("dave");
    expect(r.slug).toBe("best-of-2024");
    expect(r.url).toBe("https://letterboxd.com/dave/list/best-of-2024/");
  });

  it("accepts a list URL without trailing slash", () => {
    const r = parseLetterboxdListUrl("https://letterboxd.com/dave/list/best-of-2024");
    expect(r.username).toBe("dave");
    expect(r.slug).toBe("best-of-2024");
  });

  it("accepts the watchlist alias", () => {
    const r = parseLetterboxdListUrl("https://letterboxd.com/dave/watchlist/");
    expect(r.username).toBe("dave");
    expect(r.slug).toBe("watchlist");
    expect(r.url).toBe("https://letterboxd.com/dave/watchlist/");
  });

  it("accepts www.letterboxd.com", () => {
    const r = parseLetterboxdListUrl("https://www.letterboxd.com/dave/list/foo/");
    expect(r.username).toBe("dave");
  });

  it("rejects a non-Letterboxd host", () => {
    expect(() => parseLetterboxdListUrl("https://imdb.com/list/abc")).toThrow(
      InvalidLetterboxdUrlError,
    );
  });

  it("rejects a junk URL", () => {
    expect(() => parseLetterboxdListUrl("not-a-url")).toThrow(InvalidLetterboxdUrlError);
  });

  it("rejects a profile URL with no list path", () => {
    expect(() => parseLetterboxdListUrl("https://letterboxd.com/dave/")).toThrow(
      InvalidLetterboxdUrlError,
    );
  });

  it("rejects a film URL (not a list)", () => {
    expect(() => parseLetterboxdListUrl("https://letterboxd.com/film/dune/")).toThrow(
      InvalidLetterboxdUrlError,
    );
  });
});

// --- HTML scraping ---

describe("parseLetterboxdListHtml", () => {
  it("extracts each film's slug, title and year from a typical list", () => {
    const html = `
      <ul>
        <li class="poster-container">
          <div class="poster" data-film-slug="dune-part-two" data-film-name="Dune: Part Two" data-film-release-year="2024"></div>
        </li>
        <li class="poster-container">
          <div class="poster" data-film-slug="oppenheimer" data-film-name="Oppenheimer" data-film-release-year="2023"></div>
        </li>
      </ul>
    `;
    const films = parseLetterboxdListHtml(html);
    expect(films).toHaveLength(2);
    expect(films[0]).toMatchObject({
      slug: "dune-part-two",
      title: "Dune: Part Two",
      year: 2024,
      letterboxdUrl: "https://letterboxd.com/film/dune-part-two/",
    });
    expect(films[1]).toMatchObject({
      slug: "oppenheimer",
      title: "Oppenheimer",
      year: 2023,
    });
  });

  it("dedupes by slug within a single page", () => {
    const html = `
      <li class="poster-container"><div data-film-slug="dune" data-film-name="Dune" data-film-release-year="2021"></div></li>
      <li class="poster-container"><div data-film-slug="dune" data-film-name="Dune" data-film-release-year="2021"></div></li>
    `;
    const films = parseLetterboxdListHtml(html);
    expect(films).toHaveLength(1);
    expect(films[0]?.slug).toBe("dune");
  });

  it("falls back to a year embedded in the frame title", () => {
    const html = `
      <li class="poster-container">
        <div data-film-slug="missing-year" data-film-name="Missing Year"></div>
        <span class="frame-title">Missing Year (1999)</span>
      </li>
    `;
    const films = parseLetterboxdListHtml(html);
    expect(films[0]?.year).toBe(1999);
  });

  it("emits null year when neither attribute nor frame have one", () => {
    const html = `<li class="poster-container"><div data-film-slug="x" data-film-name="X"></div></li>`;
    const films = parseLetterboxdListHtml(html);
    expect(films[0]?.year).toBeNull();
  });

  it("skips a poster block missing data-film-slug", () => {
    const html = `<li class="poster-container"><div data-film-name="No Slug"></div></li>`;
    const films = parseLetterboxdListHtml(html);
    expect(films).toHaveLength(0);
  });

  it("returns an empty array on a page with no film blocks", () => {
    expect(parseLetterboxdListHtml("<html><body>Empty</body></html>")).toEqual([]);
  });

  // ---- Modern (LazyPoster) shape ----
  //
  // Letterboxd's React rebuild emits LazyPoster react-component divs with
  // `data-item-slug` + `data-item-name` (the latter carries `Title (YYYY)`).
  // Both shapes co-exist across pages as of 2026-05; the parser handles
  // either.
  it("extracts a film from the modern LazyPoster shape", () => {
    const html = `
      <li>
        <div class="react-component"
             data-component-class="LazyPoster"
             data-item-name="Dune: Part Two (2024)"
             data-item-slug="dune-part-two"
             data-item-link="/film/dune-part-two/">
        </div>
      </li>
    `;
    const films = parseLetterboxdListHtml(html);
    expect(films).toHaveLength(1);
    expect(films[0]).toMatchObject({
      slug: "dune-part-two",
      title: "Dune: Part Two",
      year: 2024,
      letterboxdUrl: "https://letterboxd.com/film/dune-part-two/",
    });
  });

  it("handles a modern entry whose name has no year", () => {
    const html = `
      <div class="react-component" data-component-class="LazyPoster"
        data-item-name="Ray Gunn" data-item-slug="ray-gunn" data-item-link="/film/ray-gunn/"></div>
    `;
    const films = parseLetterboxdListHtml(html);
    expect(films[0]?.title).toBe("Ray Gunn");
    expect(films[0]?.year).toBeNull();
  });

  it("falls back to data-item-link when data-item-slug is missing", () => {
    const html = `
      <div class="react-component" data-component-class="LazyPoster"
        data-item-name="Arrival (2016)" data-item-link="/film/arrival/"></div>
    `;
    const films = parseLetterboxdListHtml(html);
    expect(films[0]?.slug).toBe("arrival");
  });

  it("dedupes a film that appears in both modern and legacy shapes on one page", () => {
    const html = `
      <div class="react-component" data-component-class="LazyPoster"
        data-item-name="Dune (2021)" data-item-slug="dune" data-item-link="/film/dune/"></div>
      <li class="poster-container">
        <div data-film-slug="dune" data-film-name="Dune" data-film-release-year="2021"></div>
      </li>
    `;
    const films = parseLetterboxdListHtml(html);
    expect(films).toHaveLength(1);
  });
});

// --- previewLetterboxdList (route helper) ---

function makeFetcherMock(
  responses: Array<{
    ok?: boolean;
    status?: number;
    body?: string | object;
  }>,
) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i] ?? { status: 500, body: "" };
    i += 1;
    return {
      ok: r.ok ?? (r.status ?? 200) < 400,
      status: r.status ?? 200,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
      json: async () => (typeof r.body === "string" ? JSON.parse(r.body) : r.body),
    } as Response;
  });
}

async function probePreview(url: string, fetcher: typeof fetch) {
  const app = new Hono();
  app.post("/probe", async (c) => {
    const r = await previewLetterboxdList(c, url, { fetcher });
    if (!r.ok) return r.response;
    return c.json({ preview: r.preview, config: r.config });
  });
  const res = await app.request("/probe", { method: "POST" });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("previewLetterboxdList", () => {
  it("returns INVALID_LETTERBOXD_URL on a non-letterboxd URL", async () => {
    const r = await probePreview("https://imdb.com/list/abc", makeFetcherMock([]));
    expect(r.status).toBe(400);
    expect((r.body as { details: { code: string } }).details.code).toBe("INVALID_LETTERBOXD_URL");
  });

  it("returns INVALID_LETTERBOXD_URL on a junk URL", async () => {
    const r = await probePreview("not-a-url", makeFetcherMock([]));
    expect(r.status).toBe(400);
    expect((r.body as { details: { code: string } }).details.code).toBe("INVALID_LETTERBOXD_URL");
  });

  it("returns LIST_NOT_FOUND on a 404 from Letterboxd", async () => {
    const fetcher = makeFetcherMock([{ status: 404, body: "" }]);
    const r = await probePreview(
      "https://letterboxd.com/dave/list/missing/",
      fetcher as unknown as typeof fetch,
    );
    expect(r.status).toBe(400);
    expect((r.body as { details: { code: string } }).details.code).toBe("LIST_NOT_FOUND");
  });

  it("returns LIST_NOT_AVAILABLE on a 403 from Letterboxd", async () => {
    const fetcher = makeFetcherMock([{ status: 403, body: "" }]);
    const r = await probePreview(
      "https://letterboxd.com/dave/list/private/",
      fetcher as unknown as typeof fetch,
    );
    expect(r.status).toBe(400);
    expect((r.body as { details: { code: string } }).details.code).toBe("LIST_NOT_AVAILABLE");
  });

  it("returns the normalized config + preview on a public list", async () => {
    const html = `
      <li class="poster-container"><div data-film-slug="dune" data-film-name="Dune" data-film-release-year="2021"></div></li>
      <li class="poster-container"><div data-film-slug="arrival" data-film-name="Arrival" data-film-release-year="2016"></div></li>
    `;
    const fetcher = makeFetcherMock([{ ok: true, body: html }]);
    const r = await probePreview(
      "https://letterboxd.com/dave/list/villeneuve/",
      fetcher as unknown as typeof fetch,
    );
    expect(r.status).toBe(200);
    const body = r.body as {
      preview: { kind: string; username: string; slug: string; filmCount: number };
      config: { letterboxdUrl: string; letterboxdUsername: string; letterboxdListSlug: string };
    };
    expect(body.preview.kind).toBe("letterboxd_list");
    expect(body.preview.username).toBe("dave");
    expect(body.preview.slug).toBe("villeneuve");
    expect(body.preview.filmCount).toBe(2);
    expect(body.config.letterboxdUsername).toBe("dave");
    expect(body.config.letterboxdListSlug).toBe("villeneuve");
  });

  it("returns filmCount=0 for an empty list", async () => {
    const fetcher = makeFetcherMock([{ ok: true, body: "<html><body>Empty</body></html>" }]);
    const r = await probePreview(
      "https://letterboxd.com/dave/list/empty/",
      fetcher as unknown as typeof fetch,
    );
    expect(r.status).toBe(200);
    expect((r.body as { preview: { filmCount: number } }).preview.filmCount).toBe(0);
  });
});

// --- syncLetterboxdListSource ---
//
// Sync stamps `kind=movie` items into the parent list — proving that the
// produced item kind is decoupled from the source kind (`letterboxd_list`).

interface CapturedSql {
  text: string;
  params: unknown[];
}

function paramsFromDrizzleSql(query: unknown): unknown[] {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.filter(
    (chunk) =>
      typeof chunk !== "object" ||
      chunk === null ||
      !(chunk as Record<string, unknown>).value ||
      !Array.isArray((chunk as Record<string, unknown>).value),
  );
}

function makeCapturingDb(returns: Array<{ id: string }[]>) {
  const calls: CapturedSql[] = [];
  let i = 0;
  return {
    calls,
    db: {
      async execute(query: unknown) {
        const params = paramsFromDrizzleSql(query);
        const chunks =
          (query as { queryChunks?: Array<{ value?: string[] } | unknown> }).queryChunks ?? [];
        const text = chunks
          .map((c) =>
            typeof c === "object" && c !== null && Array.isArray((c as { value?: string[] }).value)
              ? (c as { value: string[] }).value.join("")
              : "?",
          )
          .join("");
        calls.push({ text, params });
        const result = returns[i] ?? [];
        i += 1;
        return result as unknown;
      },
    },
  };
}

const VALID_LIST = {
  letterboxdUrl: "https://letterboxd.com/dave/list/villeneuve/",
  letterboxdUsername: "dave",
  letterboxdListSlug: "villeneuve",
};

const SAMPLE_HTML = `
  <li class="poster-container"><div data-film-slug="dune" data-film-name="Dune" data-film-release-year="2021"></div></li>
  <li class="poster-container"><div data-film-slug="arrival" data-film-name="Arrival" data-film-release-year="2016"></div></li>
`;

describe("syncLetterboxdListSource", () => {
  it("produces kind='movie' items (NOT 'letterboxd_film' — proves §3.3 decoupling)", async () => {
    const fetcher = makeFetcherMock([{ ok: true, body: SAMPLE_HTML }]);
    const enrich = vi.fn(
      async (_slug: string, scraped: ScrapedFilm): Promise<TmdbMovieRecord | null> => ({
        tmdbId: scraped.slug === "dune" ? "438631" : "329865",
        title: scraped.title ?? scraped.slug,
        year: scraped.year ?? null,
        posterUrl: "https://image.tmdb.org/t/p/w500/x.jpg",
        runtimeMinutes: 120,
        overview: "summary",
      }),
    );
    const { db, calls } = makeCapturingDb([[{ id: "x" }], [{ id: "y" }]]);
    const result = await syncLetterboxdListSource({
      listId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      config: VALID_LIST,
      db: db as unknown as Parameters<typeof syncLetterboxdListSource>[0]["db"],
      deps: { fetcher: fetcher as unknown as typeof fetch, enrich },
    });
    expect(result.addedCount).toBe(2);
    // Both INSERTs targeted the `movie` kind, not a letterboxd-specific one.
    for (const call of calls) {
      expect(call.text).toContain("'movie'");
      expect(call.text).not.toContain("'letterboxd_film'");
    }
  });

  it("writes tmdbId into the content jsonb for dedup (§9.3 dedup field)", async () => {
    const fetcher = makeFetcherMock([{ ok: true, body: SAMPLE_HTML }]);
    const enrich = vi.fn(
      async (_slug: string, _scraped: ScrapedFilm): Promise<TmdbMovieRecord | null> => ({
        tmdbId: "438631",
        title: "Dune",
        year: 2021,
        posterUrl: null,
        runtimeMinutes: 155,
        overview: null,
      }),
    );
    const { db, calls } = makeCapturingDb([[{ id: "x" }], [{ id: "y" }]]);
    await syncLetterboxdListSource({
      listId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      config: VALID_LIST,
      db: db as unknown as Parameters<typeof syncLetterboxdListSource>[0]["db"],
      deps: { fetcher: fetcher as unknown as typeof fetch, enrich },
    });
    // Pull the jsonb param from the first call and inspect.
    const params0 = calls[0]?.params ?? [];
    const jsonParam = params0.find(
      (p) => typeof p === "string" && p.startsWith("{") && p.includes("tmdbId"),
    );
    expect(jsonParam).toBeDefined();
    const parsed = JSON.parse(jsonParam as string) as Record<string, unknown>;
    expect(parsed.tmdbId).toBe("438631");
    expect(parsed.source).toBe("tmdb");
    expect(parsed.letterboxdUrl).toBe("https://letterboxd.com/film/dune/");
  });

  it("falls back to source='letterboxd' when TMDB enrichment misses", async () => {
    const fetcher = makeFetcherMock([{ ok: true, body: SAMPLE_HTML }]);
    const enrich = vi.fn(async () => null); // no TMDB hit
    const { db, calls } = makeCapturingDb([[{ id: "x" }], [{ id: "y" }]]);
    await syncLetterboxdListSource({
      listId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      config: VALID_LIST,
      db: db as unknown as Parameters<typeof syncLetterboxdListSource>[0]["db"],
      deps: { fetcher: fetcher as unknown as typeof fetch, enrich },
    });
    const params0 = calls[0]?.params ?? [];
    const jsonParam = params0.find(
      (p) => typeof p === "string" && p.startsWith("{") && p.includes("letterboxdUrl"),
    );
    expect(jsonParam).toBeDefined();
    const parsed = JSON.parse(jsonParam as string) as Record<string, unknown>;
    expect(parsed.source).toBe("letterboxd");
    expect(parsed.tmdbId).toBeUndefined();
    expect(parsed.year).toBe(2021); // scraped year still flows through
  });

  it("returns addedCount = number of films when none conflict", async () => {
    const fetcher = makeFetcherMock([{ ok: true, body: SAMPLE_HTML }]);
    const { db } = makeCapturingDb([[{ id: "x" }], [{ id: "y" }]]);
    const result = await syncLetterboxdListSource({
      listId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      config: VALID_LIST,
      db: db as unknown as Parameters<typeof syncLetterboxdListSource>[0]["db"],
      deps: {
        fetcher: fetcher as unknown as typeof fetch,
        enrich: async () => null,
      },
    });
    expect(result.addedCount).toBe(2);
    expect(result.refreshedAt).toBeInstanceOf(Date);
  });

  it("ignores rows that conflict via the partial unique index (ON CONFLICT DO NOTHING)", async () => {
    const fetcher = makeFetcherMock([{ ok: true, body: SAMPLE_HTML }]);
    // First INSERT no-ops (the film is already on the list), second inserts.
    const { db } = makeCapturingDb([[], [{ id: "y" }]]);
    const result = await syncLetterboxdListSource({
      listId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      config: VALID_LIST,
      db: db as unknown as Parameters<typeof syncLetterboxdListSource>[0]["db"],
      deps: {
        fetcher: fetcher as unknown as typeof fetch,
        enrich: async () => null,
      },
    });
    expect(result.addedCount).toBe(1);
  });

  it("propagates a scrape failure as LetterboxdScrapeError", async () => {
    const fetcher = makeFetcherMock([{ status: 500, body: "" }]);
    const { db } = makeCapturingDb([]);
    await expect(
      syncLetterboxdListSource({
        listId: "00000000-0000-4000-8000-000000000001",
        userId: "00000000-0000-4000-8000-000000000002",
        config: VALID_LIST,
        db: db as unknown as Parameters<typeof syncLetterboxdListSource>[0]["db"],
        deps: { fetcher: fetcher as unknown as typeof fetch },
      }),
    ).rejects.toBeInstanceOf(LetterboxdScrapeError);
  });
});
