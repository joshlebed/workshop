import { describe, expect, it, vi } from "vitest";
import { CacheTtl, lookupCacheEntry, upsertCacheEntry } from "./metadata-cache.js";

function fakeDb(rows: Array<Record<string, unknown>>) {
  return { execute: vi.fn(async () => rows) };
}

describe("CacheTtl", () => {
  it("uses 30 days for tmdb + google books and 7 days for link preview", () => {
    expect(CacheTtl.tmdb).toBe(30 * 86400);
    expect(CacheTtl.googleBooks).toBe(30 * 86400);
    expect(CacheTtl.linkPreview).toBe(7 * 86400);
  });
});

describe("lookupCacheEntry", () => {
  it("returns null when nothing matches", async () => {
    const db = fakeDb([]);
    const r = await lookupCacheEntry("tmdb:movie", "q-search:dune", db);
    expect(r).toBeNull();
  });

  it("parses a row into a CacheEntry", async () => {
    const fetched = new Date("2026-04-25T00:00:00Z");
    const expires = new Date("2026-05-25T00:00:00Z");
    const db = fakeDb([
      {
        source: "tmdb:movie",
        source_id: "q-search:dune",
        data: [{ id: "1" }],
        fetched_at: fetched,
        expires_at: expires,
      },
    ]);
    const r = await lookupCacheEntry<unknown[]>("tmdb:movie", "q-search:dune", db);
    expect(r).toEqual({
      source: "tmdb:movie",
      sourceId: "q-search:dune",
      data: [{ id: "1" }],
      fetchedAt: fetched,
      expiresAt: expires,
    });
  });

  it("issues exactly one execute call per lookup", async () => {
    const db = fakeDb([]);
    await lookupCacheEntry("s", "k", db);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it("returns null when the rows shape is { rows: [] }", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })) };
    const r = await lookupCacheEntry("s", "k", db);
    expect(r).toBeNull();
  });
});

describe("upsertCacheEntry", () => {
  it("rejects non-positive ttl", async () => {
    const db = fakeDb([]);
    await expect(upsertCacheEntry("s", "k", { ok: 1 }, 0, db)).rejects.toThrow(/ttlSeconds/);
    await expect(upsertCacheEntry("s", "k", { ok: 1 }, -1, db)).rejects.toThrow(/ttlSeconds/);
    await expect(upsertCacheEntry("s", "k", { ok: 1 }, Number.NaN, db)).rejects.toThrow(
      /ttlSeconds/,
    );
  });

  it("issues exactly one execute call per upsert", async () => {
    const db = fakeDb([]);
    await upsertCacheEntry("tmdb:movie", "q-search:dune", { results: [] }, 60, db);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
