import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigForTesting } from "../config.js";
import {
  fetchPlaylistAlbumExtracts,
  fetchPlaylistMeta,
  getAppToken,
  PlaylistNotAvailableError,
  resetTokenCacheForTesting,
  SpotifyApiError,
} from "./app-client.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetTokenCacheForTesting();
  resetConfigForTesting();
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
  process.env.SPOTIFY_CLIENT_ID = "client-abc";
  process.env.SPOTIFY_CLIENT_SECRET = "secret-def";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function tokenResponse(value: string, expiresIn: number): Response {
  return jsonResponse({ access_token: value, token_type: "Bearer", expires_in: expiresIn });
}

describe("getAppToken", () => {
  it("fetches and caches a token", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(tokenResponse("token-1", 3600));
    const token = await getAppToken(fetcher as unknown as typeof fetch);
    expect(token).toBe("token-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const second = await getAppToken(fetcher as unknown as typeof fetch);
    expect(second).toBe("token-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the cached token is near expiry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("token-1", 30)) // 30s — within 60s buffer
      .mockResolvedValueOnce(tokenResponse("token-2", 3600));
    const first = await getAppToken(fetcher as unknown as typeof fetch);
    const second = await getAppToken(fetcher as unknown as typeof fetch);
    expect(first).toBe("token-1");
    expect(second).toBe("token-2");
  });
});

describe("fetchPlaylistMeta", () => {
  it("returns parsed playlist metadata", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tk", 3600))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "abc",
          name: "Saturday Vinyl",
          public: true,
          owner: { display_name: "kira" },
          tracks: { total: 42 },
        }),
      );
    const meta = await fetchPlaylistMeta("abc", { fetcher: fetcher as unknown as typeof fetch });
    expect(meta.name).toBe("Saturday Vinyl");
    expect(meta.tracks.total).toBe(42);
  });

  it("throws PlaylistNotAvailableError on 404", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tk", 3600))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(
      fetchPlaylistMeta("abc", { fetcher: fetcher as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(PlaylistNotAvailableError);
  });

  it("retries once on 401 with a fresh token", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("token-1", 3600))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("token-2", 3600))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "abc",
          name: "ok",
          public: true,
          owner: { display_name: null },
          tracks: { total: 0 },
        }),
      );
    const meta = await fetchPlaylistMeta("abc", { fetcher: fetcher as unknown as typeof fetch });
    expect(meta.name).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("throws SpotifyApiError on 500", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tk", 3600))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(
      fetchPlaylistMeta("abc", { fetcher: fetcher as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(SpotifyApiError);
  });
});

describe("fetchPlaylistAlbumExtracts", () => {
  it("dedupes albums and walks pagination", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("tk", 3600))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              track: {
                album: {
                  id: "alb1",
                  name: "Album One",
                  artists: [{ name: "Artist A" }],
                  release_date: "2013-05-17",
                  total_tracks: 13,
                  images: [{ url: "https://img/alb1.jpg" }],
                  external_urls: { spotify: "https://open.spotify.com/album/alb1" },
                },
              },
            },
            { track: null },
            {
              track: {
                album: {
                  id: "alb1", // dup
                  name: "Album One",
                  artists: [{ name: "Artist A" }],
                  release_date: "2013-05-17",
                  total_tracks: 13,
                  images: [],
                  external_urls: {},
                },
              },
            },
          ],
          next: "https://api.spotify.com/v1/playlists/abc/tracks?offset=100",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              track: {
                album: {
                  id: "alb2",
                  name: "Album Two",
                  artists: [{ name: "B" }, { name: "C" }],
                  release_date: "2007",
                  total_tracks: 10,
                  images: [{ url: "https://img/alb2.jpg" }],
                  external_urls: { spotify: "https://open.spotify.com/album/alb2" },
                },
              },
            },
          ],
          next: null,
        }),
      );

    const extracts = await fetchPlaylistAlbumExtracts("abc", {
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(extracts.map((e) => e.spotifyAlbumId)).toEqual(["alb1", "alb2"]);
    expect(extracts[0]?.year).toBe(2013);
    expect(extracts[0]?.coverUrl).toBe("https://img/alb1.jpg");
    expect(extracts[1]?.artist).toBe("B, C");
    expect(extracts[1]?.year).toBe(2007);
  });

  it("stops after MAX_PAGES even if Spotify keeps returning next", async () => {
    let tokenCalls = 0;
    let pageCalls = 0;
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith("https://accounts.spotify.com/")) {
        tokenCalls += 1;
        return tokenResponse("tk", 3600);
      }
      pageCalls += 1;
      // Each call returns a fresh Response — Response bodies are single-read.
      return jsonResponse({
        items: [],
        next: "https://api.spotify.com/v1/playlists/abc/tracks?offset=loop",
      });
    });
    const extracts = await fetchPlaylistAlbumExtracts("abc", {
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(extracts).toEqual([]);
    expect(pageCalls).toBe(10);
    expect(tokenCalls).toBe(1);
  });
});
