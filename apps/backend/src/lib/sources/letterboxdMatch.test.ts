import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../config.js";
import type { ScrapedFilm, TmdbMovieRecord } from "./letterboxdList.js";
import { MATCH_THRESHOLD, syncLetterboxdMatchSource } from "./letterboxdMatch.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  resetConfigForTesting();
});

// Scripted db.execute mock: each call pops the next canned result. The SQL
// text is captured for assertions (drizzle's queryChunks carry the literal
// fragments as `{ value: string[] }` entries).
function makeScriptedDb(returns: unknown[][]) {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    db: {
      async execute(query: unknown) {
        const chunks =
          (query as { queryChunks?: Array<{ value?: string[] } | unknown> }).queryChunks ?? [];
        calls.push(
          chunks
            .map((c) =>
              typeof c === "object" &&
              c !== null &&
              Array.isArray((c as { value?: string[] }).value)
                ? (c as { value: string[] }).value.join("")
                : "?",
            )
            .join(""),
        );
        const result = returns[i] ?? [];
        i += 1;
        return result;
      },
    } as unknown as Parameters<typeof syncLetterboxdMatchSource>[0]["db"],
  };
}

const LIST_ID = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-000000000002";

const FRESH = new Date().toISOString();

function member(userId: string, username: string, syncedAt: string | null = FRESH) {
  return { user_id: userId, letterboxd_username: username, letterboxd_synced_at: syncedAt };
}

const enrichHit = vi.fn(
  async (scraped: ScrapedFilm): Promise<TmdbMovieRecord | null> => ({
    tmdbId: `tmdb-${scraped.slug}`,
    title: scraped.title ?? scraped.slug,
    year: scraped.year,
    posterUrl: null,
    runtimeMinutes: null,
    overview: null,
  }),
);

describe("syncLetterboxdMatchSource", () => {
  it("inserts overlap films (≥2 members) as kind='movie' items", async () => {
    const { db, calls } = makeScriptedDb([
      // 1: connected members (both fresh — no per-user re-scrape)
      [member("u1", "dave"), member("u2", "kim")],
      // 2: overlap query
      [{ film_slug: "dune", title: "Dune", year: 2021, member_count: 2 }],
      // 3: existing films on the list
      [],
      // 4: INSERT … RETURNING id
      [{ id: "item-1" }],
    ]);
    const result = await syncLetterboxdMatchSource({
      listId: LIST_ID,
      userId: ACTOR,
      config: {},
      db,
      deps: { enrich: enrichHit },
    });
    expect(result.addedCount).toBe(1);
    const insert = calls.find((c) => c.includes("INSERT INTO items"));
    expect(insert).toBeDefined();
    expect(insert).toContain("'movie'");
  });

  it("returns 0 added without querying overlap when fewer than MATCH_THRESHOLD members connected", async () => {
    const { db, calls } = makeScriptedDb([[member("u1", "dave")]]);
    const result = await syncLetterboxdMatchSource({
      listId: LIST_ID,
      userId: ACTOR,
      config: {},
      db,
      deps: { enrich: enrichHit },
    });
    expect(MATCH_THRESHOLD).toBe(2);
    expect(result.addedCount).toBe(0);
    expect(calls.some((c) => c.includes("HAVING"))).toBe(false);
  });

  it("skips films already on the list by slug — archived rows stay archived", async () => {
    const { db, calls } = makeScriptedDb([
      [member("u1", "dave"), member("u2", "kim")],
      [{ film_slug: "dune", title: "Dune", year: 2021, member_count: 2 }],
      // Existing rows include the same slug (e.g. the group archived it).
      [{ slug: "dune", tmdb_id: "tmdb-dune" }],
    ]);
    const result = await syncLetterboxdMatchSource({
      listId: LIST_ID,
      userId: ACTOR,
      config: {},
      db,
      deps: { enrich: enrichHit },
    });
    expect(result.addedCount).toBe(0);
    expect(calls.some((c) => c.includes("INSERT INTO items"))).toBe(false);
  });

  it("skips films whose enriched tmdbId already exists under a different slug", async () => {
    const enrichSame = vi.fn(
      async (): Promise<TmdbMovieRecord | null> => ({
        tmdbId: "438631",
        title: "Dune",
        year: 2021,
        posterUrl: null,
        runtimeMinutes: null,
        overview: null,
      }),
    );
    const { db, calls } = makeScriptedDb([
      [member("u1", "dave"), member("u2", "kim")],
      [{ film_slug: "dune-2021", title: "Dune", year: 2021, member_count: 2 }],
      [{ slug: "dune", tmdb_id: "438631" }],
    ]);
    const result = await syncLetterboxdMatchSource({
      listId: LIST_ID,
      userId: ACTOR,
      config: {},
      db,
      deps: { enrich: enrichSame },
    });
    expect(result.addedCount).toBe(0);
    expect(calls.some((c) => c.includes("INSERT INTO items"))).toBe(false);
  });

  it("re-scrapes a stale member's watchlist before matching", async () => {
    const staleSyncedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const watchlistHtml = `
      <li class="poster-container"><div data-film-slug="dune" data-film-name="Dune" data-film-release-year="2021"></div></li>
    `;
    const fetcher = vi.fn(
      async () =>
        ({ ok: true, status: 200, text: async () => watchlistHtml }) as unknown as Response,
    );
    const { db, calls } = makeScriptedDb([
      // 1: members — u1 stale, u2 fresh
      [member("u1", "dave", staleSyncedAt), member("u2", "kim")],
      // 2-4: u1's watchlist re-sync (DELETE, INSERT chunk, UPDATE users)
      [],
      [],
      [],
      // 5: overlap
      [],
    ]);
    const result = await syncLetterboxdMatchSource({
      listId: LIST_ID,
      userId: ACTOR,
      config: {},
      db,
      deps: { enrich: enrichHit, fetcher: fetcher as unknown as typeof fetch },
    });
    expect(result.addedCount).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce(); // one page, one fetch — only the stale member
    expect(calls.some((c) => c.includes("DELETE FROM letterboxd_watchlist_films"))).toBe(true);
  });

  it("a failed member scrape degrades to their stale cache instead of failing the sync", async () => {
    const staleSyncedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const fetcher = vi.fn(async () => {
      throw new Error("letterboxd down");
    });
    const { db } = makeScriptedDb([
      [member("u1", "dave", staleSyncedAt), member("u2", "kim")],
      // overlap still runs off the stale cache
      [{ film_slug: "dune", title: "Dune", year: 2021, member_count: 2 }],
      [],
      [{ id: "item-1" }],
    ]);
    const result = await syncLetterboxdMatchSource({
      listId: LIST_ID,
      userId: ACTOR,
      config: {},
      db,
      deps: { enrich: enrichHit, fetcher: fetcher as unknown as typeof fetch },
    });
    expect(result.addedCount).toBe(1);
  });
});
