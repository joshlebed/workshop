import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  PlaylistNotAvailableError,
  SpotifyApiError,
  SpotifyAuthError,
  SpotifyConfigError,
} from "./app-client.js";
import { mapSpotifyError } from "./error-mapping.js";

function appThrowing(error: unknown) {
  const app = new Hono();
  app.get("/", (c) => {
    const mapped = mapSpotifyError(c, error);
    if (mapped) return mapped;
    throw error;
  });
  return app;
}

describe("mapSpotifyError", () => {
  it("PlaylistNotAvailableError → 400 PLAYLIST_NOT_AVAILABLE", async () => {
    const res = await appThrowing(new PlaylistNotAvailableError()).request("/");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "VALIDATION",
      details: { code: "PLAYLIST_NOT_AVAILABLE" },
    });
  });

  it("SpotifyConfigError → 500 INTERNAL", async () => {
    const res = await appThrowing(new SpotifyConfigError()).request("/");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "INTERNAL" });
  });

  it("SpotifyAuthError → 500 SPOTIFY_UNAVAILABLE", async () => {
    const res = await appThrowing(new SpotifyAuthError()).request("/");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      code: "INTERNAL",
      details: { code: "SPOTIFY_UNAVAILABLE" },
    });
  });

  it("SpotifyApiError → 500 SPOTIFY_UNAVAILABLE", async () => {
    const res = await appThrowing(new SpotifyApiError(503)).request("/");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      code: "INTERNAL",
      details: { code: "SPOTIFY_UNAVAILABLE" },
    });
  });

  it("returns null for unknown errors so the caller can rethrow", async () => {
    // Hono's default handler 500s on rethrow, which is what production sees.
    const res = await appThrowing(new Error("boom")).request("/");
    expect(res.status).toBe(500);
  });
});
