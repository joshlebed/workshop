import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

// Rate-limit middleware reads getDb() unconditionally. The vitest harness
// sets DATABASE_URL to a placeholder that postgres-js can't connect to; the
// middleware's fail-open path catches the throw, but postgres-js's client
// pool ends up wedged for subsequent tests in the same file. Bypass it by
// turning the middleware into a passthrough — these tests only exercise the
// route logic, not the rate-limit semantics.
vi.mock("../../middleware/rate-limit.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<unknown>) => next(),
}));

const { __internal, __testing, searchRoutes } = await import("./search.js");

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

afterEach(() => {
  delete process.env.TMDB_API_KEY;
  delete process.env.GOOGLE_BOOKS_API_KEY;
  resetConfigForTesting();
  __testing.reset();
});

function authHeaders(): { Authorization: string } {
  return { Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}` };
}

// Mock the cache so tests don't try to reach the real DB. Each route test
// that hits the handler past the validation layer must set deps via
// `__testing.setDeps(...)` first.
function noCacheDeps() {
  return {
    lookupCache: async () => null,
    upsertCache: async () => undefined,
  };
}

describe("normalizeTmdbRow", () => {
  it("maps movie fields", () => {
    const r = __internal.normalizeTmdbRow(
      {
        id: 603692,
        title: "John Wick: Chapter 4",
        release_date: "2023-03-22",
        poster_path: "/foo.jpg",
        overview: "the franchise continues",
      },
      "movie",
    );
    expect(r).toEqual({
      id: "603692",
      title: "John Wick: Chapter 4",
      year: 2023,
      posterUrl: "https://image.tmdb.org/t/p/w500/foo.jpg",
      overview: "the franchise continues",
    });
  });

  it("maps tv fields with first_air_date and episode_run_time", () => {
    const r = __internal.normalizeTmdbRow(
      {
        id: 1,
        name: "Show",
        first_air_date: "2024-01-15",
        poster_path: null,
        overview: "",
        episode_run_time: [42],
      },
      "tv",
    );
    expect(r).toMatchObject({
      id: "1",
      title: "Show",
      year: 2024,
      posterUrl: null,
      runtimeMinutes: 42,
      overview: null,
    });
  });

  it("returns null year when release_date is missing or malformed", () => {
    const r = __internal.normalizeTmdbRow({ id: 9, title: "Untitled", release_date: "" }, "movie");
    expect(r.year).toBeNull();
  });
});

describe("normalizeGoogleBooksRow", () => {
  it("maps a typical volume", () => {
    const r = __internal.normalizeGoogleBooksRow({
      id: "abc",
      volumeInfo: {
        title: "The Fifth Season",
        authors: ["N.K. Jemisin"],
        publishedDate: "2015-08-04",
        pageCount: 512,
        imageLinks: { thumbnail: "http://books.example/cover.jpg" },
        description: "first of three",
      },
    });
    expect(r).toEqual({
      id: "abc",
      title: "The Fifth Season",
      authors: ["N.K. Jemisin"],
      year: 2015,
      coverUrl: "https://books.example/cover.jpg",
      pageCount: 512,
      description: "first of three",
    });
  });

  it("falls back to smallThumbnail and tolerates missing authors", () => {
    const r = __internal.normalizeGoogleBooksRow({
      id: "z",
      volumeInfo: {
        title: "x",
        publishedDate: "1999",
        imageLinks: { smallThumbnail: "https://books.example/small.jpg" },
      },
    });
    expect(r).toMatchObject({
      year: 1999,
      authors: [],
      coverUrl: "https://books.example/small.jpg",
    });
    expect(r.pageCount).toBeUndefined();
  });
});

describe("GET /v1/search/media auth + validation", () => {
  it("requires a bearer token", async () => {
    const res = await searchRoutes.request("/media?type=movie&q=dune");
    expect(res.status).toBe(401);
  });

  it("rejects unknown type", async () => {
    process.env.TMDB_API_KEY = "k";
    resetConfigForTesting();
    const res = await searchRoutes.request("/media?type=animes&q=dune", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("rejects empty q", async () => {
    process.env.TMDB_API_KEY = "k";
    resetConfigForTesting();
    const res = await searchRoutes.request("/media?type=movie&q=", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("returns 500 when TMDB_API_KEY is unset", async () => {
    resetConfigForTesting();
    const res = await searchRoutes.request("/media?type=movie&q=dune", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "INTERNAL" });
  });

  it("returns normalized results when fetcher succeeds", async () => {
    process.env.TMDB_API_KEY = "k";
    resetConfigForTesting();
    __testing.setDeps({
      ...noCacheDeps(),
      fetchTmdb: async (type, q) => [
        { id: "1", title: `${type}-${q}`, year: 2024, posterUrl: null, overview: null },
      ],
    });
    const res = await searchRoutes.request("/media?type=movie&q=dune", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ id: "1", title: "movie-dune", year: 2024, posterUrl: null, overview: null }],
    });
  });

  it("returns 500 when fetcher throws", async () => {
    process.env.TMDB_API_KEY = "k";
    resetConfigForTesting();
    __testing.setDeps({
      ...noCacheDeps(),
      fetchTmdb: async () => {
        throw new Error("upstream 500");
      },
    });
    const res = await searchRoutes.request("/media?type=movie&q=dune", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(500);
  });

  it("returns the cached result without invoking the fetcher", async () => {
    process.env.TMDB_API_KEY = "k";
    resetConfigForTesting();
    let fetcherCalls = 0;
    __testing.setDeps({
      lookupCache: (async () => ({
        data: [{ id: "9", title: "cached", year: null, posterUrl: null, overview: null }],
      })) as <T>() => Promise<{ data: T } | null>,
      upsertCache: async () => undefined,
      fetchTmdb: async () => {
        fetcherCalls++;
        return [];
      },
    });
    const res = await searchRoutes.request("/media?type=tv&q=cache", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(fetcherCalls).toBe(0);
    const body = (await res.json()) as { results: Array<{ id: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.id).toBe("9");
  });
});

describe("GET /v1/search/books auth + validation", () => {
  it("requires a bearer token", async () => {
    const res = await searchRoutes.request("/books?q=jemisin");
    expect(res.status).toBe(401);
  });

  it("rejects empty q", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = "k";
    resetConfigForTesting();
    const res = await searchRoutes.request("/books?q=", { headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  it("returns 500 when GOOGLE_BOOKS_API_KEY is unset", async () => {
    resetConfigForTesting();
    const res = await searchRoutes.request("/books?q=jemisin", { headers: authHeaders() });
    expect(res.status).toBe(500);
  });

  it("returns normalized books when fetcher succeeds", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = "k";
    resetConfigForTesting();
    __testing.setDeps({
      ...noCacheDeps(),
      fetchGoogleBooks: async (q) => [
        { id: q, title: q, authors: ["a"], year: 2020, coverUrl: null },
      ],
    });
    const res = await searchRoutes.request("/books?q=jemisin", { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ id: "jemisin", title: "jemisin", authors: ["a"], year: 2020, coverUrl: null }],
    });
  });
});
