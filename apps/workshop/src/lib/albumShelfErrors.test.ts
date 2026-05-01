import { describe, expect, it } from "vitest";
import { albumShelfErrorMessage } from "./albumShelfErrors";
import { ApiError } from "./apiError";

function apiErr(code: string): ApiError {
  return new ApiError("VALIDATION", "server message", 400, { code });
}

describe("albumShelfErrorMessage", () => {
  it("returns the invalid-URL copy for INVALID_PLAYLIST_URL", () => {
    expect(albumShelfErrorMessage(apiErr("INVALID_PLAYLIST_URL"), "fallback")).toBe(
      "That doesn't look like a Spotify playlist URL.",
    );
  });

  it("returns the not-available copy for PLAYLIST_NOT_AVAILABLE", () => {
    expect(albumShelfErrorMessage(apiErr("PLAYLIST_NOT_AVAILABLE"), "fallback")).toBe(
      "Source playlist is private or deleted. Update the source URL in settings.",
    );
  });

  it("returns the upstream copy for SPOTIFY_UNAVAILABLE", () => {
    expect(albumShelfErrorMessage(apiErr("SPOTIFY_UNAVAILABLE"), "fallback")).toBe(
      "Spotify is having a moment. Try again.",
    );
  });

  it("falls through to the error message for unrecognized codes", () => {
    expect(albumShelfErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("uses the fallback for unknown thrown values", () => {
    expect(albumShelfErrorMessage("string", "Couldn't refresh")).toBe("Couldn't refresh");
  });
});
