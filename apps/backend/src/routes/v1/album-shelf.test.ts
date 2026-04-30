import { beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../../lib/session.js";
import { albumShelfRoutes } from "./album-shelf.js";

beforeAll(() => {
  process.env.STAGE = "local";
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(32);
});

function authHeaders(): { Authorization: string; "Content-Type": string } {
  return {
    Authorization: `Bearer ${signSession("00000000-0000-0000-0000-000000000001")}`,
    "Content-Type": "application/json",
  };
}

describe("POST /v1/album-shelf/preview", () => {
  it("requires a bearer token", async () => {
    const res = await albumShelfRoutes.request("/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty body", async () => {
    const res = await albumShelfRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("rejects invalid json", async () => {
    const res = await albumShelfRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a malformed playlist URL with INVALID_PLAYLIST_URL code", async () => {
    const res = await albumShelfRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url: "not-a-spotify-url" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      code: "VALIDATION",
      details: { code: "INVALID_PLAYLIST_URL" },
    });
  });

  it("returns 500 SPOTIFY_UNAVAILABLE when creds aren't configured (no env vars)", async () => {
    // SPOTIFY_CLIENT_ID/SECRET aren't set in the test env, so the underlying
    // fetchPlaylistMeta call throws SpotifyConfigError → handled as
    // INTERNAL "spotify integration not configured".
    const res = await albumShelfRoutes.request("/preview", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ url: "https://open.spotify.com/playlist/1fdSTLB4C1ibLCl8ZMLSD3" }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "INTERNAL" });
  });
});
