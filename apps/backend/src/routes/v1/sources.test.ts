import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../../lib/config.js";
import { signSession } from "../../lib/session.js";

vi.mock("../../middleware/rate-limit.js", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<unknown>) => next(),
}));

// Mock the Spotify client so preview can run end-to-end without network.
const fetchPlaylistMetaMock = vi.fn();
const fetchPlaylistAlbumExtractsMock = vi.fn();
vi.mock("../../lib/spotify/app-client.js", () => ({
  fetchPlaylistMeta: (...args: unknown[]) => fetchPlaylistMetaMock(...args),
  fetchPlaylistAlbumExtracts: (...args: unknown[]) => fetchPlaylistAlbumExtractsMock(...args),
  PlaylistNotAvailableError: class PlaylistNotAvailableError extends Error {},
  SpotifyApiError: class SpotifyApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`spotify ${status}`);
      this.status = status;
    }
  },
  SpotifyAuthError: class SpotifyAuthError extends Error {},
  SpotifyConfigError: class SpotifyConfigError extends Error {},
}));

const { __test, sourcePreviewRoutes } = await import("./sources.js");
const { previewSpotifyPlaylist, syncSpotifyPlaylistSource } = await import(
  "../../lib/sources/spotifyPlaylist.js"
);
const { listRoutes } = await import("./lists.js");

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.SPOTIFY_CLIENT_ID = "client";
  process.env.SPOTIFY_CLIENT_SECRET = "secret";
  resetConfigForTesting();
});

beforeEach(() => {
  fetchPlaylistMetaMock.mockReset();
  fetchPlaylistAlbumExtractsMock.mockReset();
});

const validUuid = "00000000-0000-4000-8000-000000000001";

function authHeaders(): { Authorization: string; "Content-Type": string } {
  return {
    Authorization: `Bearer ${signSession(validUuid)}`,
    "Content-Type": "application/json",
  };
}

const VALID_PLAYLIST_URL = "https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd";
const VALID_PLAYLIST_ID = "37i9dQZF1DX0XUsuxWHRQd";

// Sources spans two route surfaces and one library module:
//   - `/v1/sources/preview`     (sources.ts route — the create-list flow)
//   - `/v1/lists/:id/sources*`  (lists.ts route — per-list CRUD, sync)
//   - `lib/sources/spotifyPlaylist.ts` (preview + sync implementation)
// Auth + uuid gating is verified at the route layer; the sync implementation
// is unit-tested with a mocked Spotify client so it doesn't hit the network.

describe("previewSchema", () => {
  const { previewSchema } = __test;

  it("accepts a valid Spotify config", () => {
    const r = previewSchema.safeParse({
      kind: "spotify_playlist",
      config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown source kind", () => {
    expect(previewSchema.safeParse({ kind: "rss_feed", config: {} }).success).toBe(false);
  });

  it("rejects a config that isn't an object", () => {
    expect(previewSchema.safeParse({ kind: "spotify_playlist", config: "url" }).success).toBe(
      false,
    );
  });

  it("accepts an empty config (validation happens downstream)", () => {
    expect(previewSchema.safeParse({ kind: "spotify_playlist", config: {} }).success).toBe(true);
  });
});

describe("POST /v1/sources/preview auth + validation", () => {
  it("requires a bearer token", async () => {
    const res = await sourcePreviewRoutes.request("/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await sourcePreviewRoutes.request("/preview", {
      method: "POST",
      headers: { Authorization: "Bearer x", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("400s on non-JSON body", async () => {
    const res = await sourcePreviewRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("400s on an unknown source kind", async () => {
    const res = await sourcePreviewRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ kind: "rss_feed", config: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("400s on a malformed Spotify URL", async () => {
    const res = await sourcePreviewRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        kind: "spotify_playlist",
        config: { spotifyPlaylistUrl: "https://example.com/not-a-playlist" },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("400s with PLAYLIST_NOT_AVAILABLE when the playlist isn't public", async () => {
    fetchPlaylistMetaMock.mockResolvedValueOnce({
      id: VALID_PLAYLIST_ID,
      name: "Mood Songs",
      public: false,
      owner: { display_name: "spotify" },
      tracks: { total: 10 },
    });
    const res = await sourcePreviewRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        kind: "spotify_playlist",
        config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ code: "VALIDATION" });
    expect((body as { details: { code: string } }).details.code).toBe("PLAYLIST_NOT_AVAILABLE");
  });

  it("returns a normalized preview on a valid public playlist", async () => {
    fetchPlaylistMetaMock.mockResolvedValueOnce({
      id: VALID_PLAYLIST_ID,
      name: "RapCaviar",
      public: true,
      owner: { display_name: "Spotify" },
      tracks: { total: 42 },
    });
    const res = await sourcePreviewRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        kind: "spotify_playlist",
        config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preview: {
        kind: string;
        playlistId: string;
        name: string;
        ownerName: string | null;
        trackCount: number;
      };
    };
    expect(body.preview.kind).toBe("spotify_playlist");
    expect(body.preview.playlistId).toBe(VALID_PLAYLIST_ID);
    expect(body.preview.name).toBe("RapCaviar");
    expect(body.preview.ownerName).toBe("Spotify");
    expect(body.preview.trackCount).toBe(42);
  });
});

// --- Per-list source CRUD (mounted under listRoutes) ---

describe("listRoutes /:id/sources auth + uuid gating", () => {
  it("GET /:id/sources requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/sources`);
    expect(res.status).toBe(401);
  });

  it("POST /:id/sources requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /:id/sources/:sourceId requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/sources/${validUuid}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/sources/:sourceId/sync requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/sources/${validUuid}/sync`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("POST /:id/refresh (legacy alias) requires a bearer token", async () => {
    const res = await listRoutes.request(`/${validUuid}/refresh`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("GET /:id/sources 404s when list id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/sources", { headers: authHeaders() });
    expect(res.status).toBe(404);
  });

  it("POST /:id/sources 404s when list id isn't a uuid", async () => {
    const res = await listRoutes.request("/not-a-uuid/sources", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ kind: "spotify_playlist", config: {} }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /:id/sources/:sourceId/sync 404s on bad list id", async () => {
    const res = await listRoutes.request(`/not-a-uuid/sources/${validUuid}/sync`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
  });
});

// --- previewSpotifyPlaylist (helper) ---
//
// Exercise the validate-and-shape path directly so the contract is locked at
// the lib boundary, independent of the route mounting.

import { Hono } from "hono";

async function callPreview(url: string): Promise<{ status: number; body: unknown }> {
  // Build a tiny Hono app that just invokes previewSpotifyPlaylist and either
  // returns the preview as JSON or the error Response it returned.
  const app = new Hono();
  app.post("/probe", async (c) => {
    const r = await previewSpotifyPlaylist(c, url);
    if (!r.ok) return r.response;
    return c.json({ preview: r.preview, config: r.config });
  });
  const res = await app.request("/probe", { method: "POST" });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("previewSpotifyPlaylist (lib)", () => {
  it("returns INVALID_PLAYLIST_URL on a non-playlist URL", async () => {
    const r = await callPreview("https://open.spotify.com/track/abc");
    expect(r.status).toBe(400);
    expect((r.body as { details: { code: string } }).details.code).toBe("INVALID_PLAYLIST_URL");
  });

  it("returns INVALID_PLAYLIST_URL on a junk URL", async () => {
    const r = await callPreview("not-a-url-at-all");
    expect(r.status).toBe(400);
    expect((r.body as { details: { code: string } }).details.code).toBe("INVALID_PLAYLIST_URL");
  });

  it("returns PLAYLIST_NOT_AVAILABLE when public is false", async () => {
    fetchPlaylistMetaMock.mockResolvedValueOnce({
      id: VALID_PLAYLIST_ID,
      name: "Private",
      public: false,
      owner: { display_name: "x" },
      tracks: { total: 0 },
    });
    const r = await callPreview(VALID_PLAYLIST_URL);
    expect(r.status).toBe(400);
    expect((r.body as { details: { code: string } }).details.code).toBe("PLAYLIST_NOT_AVAILABLE");
  });

  it("returns the normalized config + preview on success", async () => {
    fetchPlaylistMetaMock.mockResolvedValueOnce({
      id: VALID_PLAYLIST_ID,
      name: "Tracks I love",
      public: true,
      owner: { display_name: "ana" },
      tracks: { total: 17 },
    });
    const r = await callPreview(VALID_PLAYLIST_URL);
    expect(r.status).toBe(200);
    const body = r.body as {
      preview: { name: string; trackCount: number };
      config: { spotifyPlaylistId: string; spotifyPlaylistUrl: string };
    };
    expect(body.preview.name).toBe("Tracks I love");
    expect(body.preview.trackCount).toBe(17);
    expect(body.config.spotifyPlaylistId).toBe(VALID_PLAYLIST_ID);
    expect(body.config.spotifyPlaylistUrl).toBe(VALID_PLAYLIST_URL);
  });

  it("returns null ownerName when display_name is missing", async () => {
    fetchPlaylistMetaMock.mockResolvedValueOnce({
      id: VALID_PLAYLIST_ID,
      name: "Anon",
      public: true,
      owner: null,
      tracks: { total: 0 },
    });
    const r = await callPreview(VALID_PLAYLIST_URL);
    expect(r.status).toBe(200);
    expect((r.body as { preview: { ownerName: string | null } }).preview.ownerName).toBeNull();
  });
});

// --- syncSpotifyPlaylistSource (lib) ---
//
// Sync writes new (list_id, spotifyAlbumId) rows via an in-test DbClient
// stub — the contract is "issue one INSERT per extract, count the inserted
// rows, return refreshedAt". Tests assert the count + the timestamp shape.

interface CapturedSql {
  text: string;
  // parameters captured for assertion
  params: unknown[];
}

function paramsFromDrizzleSql(query: unknown): unknown[] {
  // drizzle-orm's sql tag exposes `queryChunks` — string fragments (objects
  // with `.value: string[]`) interleaved with raw parameter values. Filter
  // for the values so the tests can assert on what we'd send to Postgres.
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
  let returnIndex = 0;
  const db = {
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
      const result = returns[returnIndex] ?? [];
      returnIndex += 1;
      return result as unknown;
    },
  };
  return { db, calls };
}

describe("syncSpotifyPlaylistSource", () => {
  it("returns addedCount = 0 when the playlist is empty", async () => {
    fetchPlaylistAlbumExtractsMock.mockResolvedValueOnce([]);
    const { db } = makeCapturingDb([]);
    const result = await syncSpotifyPlaylistSource({
      listId: validUuid,
      userId: validUuid,
      config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL, spotifyPlaylistId: VALID_PLAYLIST_ID },
      db: db as unknown as Parameters<typeof syncSpotifyPlaylistSource>[0]["db"],
    });
    expect(result.addedCount).toBe(0);
    expect(result.refreshedAt).toBeInstanceOf(Date);
  });

  it("counts every successful INSERT (no dedup collisions)", async () => {
    fetchPlaylistAlbumExtractsMock.mockResolvedValueOnce([
      {
        spotifyAlbumId: "a1",
        spotifyAlbumUrl: "https://open.spotify.com/album/a1",
        title: "Album One",
        artist: "Artist",
        trackCount: 10,
      },
      {
        spotifyAlbumId: "a2",
        spotifyAlbumUrl: "https://open.spotify.com/album/a2",
        title: "Album Two",
        artist: "Artist",
        trackCount: 12,
        year: 2024,
      },
    ]);
    const { db, calls } = makeCapturingDb([[{ id: "x" }], [{ id: "y" }]]);
    const result = await syncSpotifyPlaylistSource({
      listId: validUuid,
      userId: validUuid,
      config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL, spotifyPlaylistId: VALID_PLAYLIST_ID },
      db: db as unknown as Parameters<typeof syncSpotifyPlaylistSource>[0]["db"],
    });
    expect(result.addedCount).toBe(2);
    expect(calls.length).toBe(2);
  });

  it("does not count rows that conflict on the per-(list, spotifyAlbumId) unique index", async () => {
    fetchPlaylistAlbumExtractsMock.mockResolvedValueOnce([
      {
        spotifyAlbumId: "a1",
        spotifyAlbumUrl: "https://open.spotify.com/album/a1",
        title: "Already there",
        artist: "Artist",
        trackCount: 10,
      },
      {
        spotifyAlbumId: "a2",
        spotifyAlbumUrl: "https://open.spotify.com/album/a2",
        title: "New",
        artist: "Artist",
        trackCount: 10,
      },
    ]);
    // First INSERT no-ops via ON CONFLICT (empty array); second inserts.
    const { db } = makeCapturingDb([[], [{ id: "y" }]]);
    const result = await syncSpotifyPlaylistSource({
      listId: validUuid,
      userId: validUuid,
      config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL, spotifyPlaylistId: VALID_PLAYLIST_ID },
      db: db as unknown as Parameters<typeof syncSpotifyPlaylistSource>[0]["db"],
    });
    expect(result.addedCount).toBe(1);
  });

  it("serializes optional year + coverUrl into content jsonb when present", async () => {
    fetchPlaylistAlbumExtractsMock.mockResolvedValueOnce([
      {
        spotifyAlbumId: "a1",
        spotifyAlbumUrl: "https://open.spotify.com/album/a1",
        title: "Cover",
        artist: "Artist",
        trackCount: 8,
        year: 2022,
        coverUrl: "https://i.scdn.co/x.jpg",
      },
    ]);
    const { db, calls } = makeCapturingDb([[{ id: "x" }]]);
    await syncSpotifyPlaylistSource({
      listId: validUuid,
      userId: validUuid,
      config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL, spotifyPlaylistId: VALID_PLAYLIST_ID },
      db: db as unknown as Parameters<typeof syncSpotifyPlaylistSource>[0]["db"],
    });
    // Find the inserted JSON content blob in the capture.
    const params = calls[0]?.params ?? [];
    const jsonParam = params.find(
      (p) => typeof p === "string" && p.startsWith("{") && p.includes("spotifyAlbumId"),
    );
    expect(jsonParam).toBeDefined();
    const parsed = JSON.parse(jsonParam as string) as Record<string, unknown>;
    expect(parsed.source).toBe("spotify");
    expect(parsed.spotifyAlbumId).toBe("a1");
    expect(parsed.year).toBe(2022);
    expect(parsed.coverUrl).toBe("https://i.scdn.co/x.jpg");
    expect(parsed.detectedAt).toBeDefined();
  });

  it("omits year and coverUrl when they're not on the extract", async () => {
    fetchPlaylistAlbumExtractsMock.mockResolvedValueOnce([
      {
        spotifyAlbumId: "a1",
        spotifyAlbumUrl: "https://open.spotify.com/album/a1",
        title: "Mystery",
        artist: "Artist",
        trackCount: 1,
      },
    ]);
    const { db, calls } = makeCapturingDb([[{ id: "x" }]]);
    await syncSpotifyPlaylistSource({
      listId: validUuid,
      userId: validUuid,
      config: { spotifyPlaylistUrl: VALID_PLAYLIST_URL, spotifyPlaylistId: VALID_PLAYLIST_ID },
      db: db as unknown as Parameters<typeof syncSpotifyPlaylistSource>[0]["db"],
    });
    const params = calls[0]?.params ?? [];
    const jsonParam = params.find(
      (p) => typeof p === "string" && p.startsWith("{") && p.includes("spotifyAlbumId"),
    );
    expect(jsonParam).toBeDefined();
    const parsed = JSON.parse(jsonParam as string) as Record<string, unknown>;
    expect(parsed.year).toBeUndefined();
    expect(parsed.coverUrl).toBeUndefined();
  });
});
