import { ApiError } from "@workshop/api-client/apiError";
import { describe, expect, it } from "vitest";
import { sourceErrorMessage } from "./sourceErrors";

function apiErr(code: string): ApiError {
  return new ApiError("VALIDATION", "server message", 400, { code });
}

describe("sourceErrorMessage", () => {
  describe("spotify, settings context (default)", () => {
    it("returns the invalid-URL copy for INVALID_PLAYLIST_URL", () => {
      expect(sourceErrorMessage(apiErr("INVALID_PLAYLIST_URL"), "fallback")).toBe(
        "That doesn't look like a Spotify playlist URL.",
      );
    });

    it("returns the not-available copy for PLAYLIST_NOT_AVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("PLAYLIST_NOT_AVAILABLE"), "fallback")).toBe(
        "Source playlist is private or deleted. Update the source URL in settings.",
      );
    });

    it("returns the upstream copy for SPOTIFY_UNAVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("SPOTIFY_UNAVAILABLE"), "fallback")).toBe(
        "Spotify is having a moment. Try again.",
      );
    });
  });

  describe("spotify, creation context", () => {
    it("uses make-it-public phrasing for PLAYLIST_NOT_AVAILABLE (no settings yet)", () => {
      expect(sourceErrorMessage(apiErr("PLAYLIST_NOT_AVAILABLE"), "fallback", "creation")).toBe(
        "That playlist isn't public. Make it public on Spotify and try again.",
      );
    });

    it("uses give-it-a-beat phrasing for SPOTIFY_UNAVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("SPOTIFY_UNAVAILABLE"), "fallback", "creation")).toBe(
        "Spotify is having a moment. Give it a beat.",
      );
    });

    it("matches the settings copy for INVALID_PLAYLIST_URL", () => {
      expect(sourceErrorMessage(apiErr("INVALID_PLAYLIST_URL"), "fallback", "creation")).toBe(
        "That doesn't look like a Spotify playlist URL.",
      );
    });
  });

  describe("letterboxd, settings context (default)", () => {
    it("returns the invalid-URL copy for INVALID_LETTERBOXD_URL", () => {
      expect(sourceErrorMessage(apiErr("INVALID_LETTERBOXD_URL"), "fallback")).toBe(
        "That doesn't look like a Letterboxd list URL.",
      );
    });

    it("returns the not-found copy for LIST_NOT_FOUND", () => {
      expect(sourceErrorMessage(apiErr("LIST_NOT_FOUND"), "fallback")).toBe(
        "Source list isn't reachable. Update the source URL in settings.",
      );
    });

    it("returns the not-available copy for LIST_NOT_AVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("LIST_NOT_AVAILABLE"), "fallback")).toBe(
        "Source list is private or deleted. Update the source URL in settings.",
      );
    });

    it("returns the upstream copy for LIST_FETCH_FAILED", () => {
      expect(sourceErrorMessage(apiErr("LIST_FETCH_FAILED"), "fallback")).toBe(
        "Letterboxd is having a moment. Try again.",
      );
    });
  });

  describe("letterboxd, creation context", () => {
    it("uses check-the-URL phrasing for LIST_NOT_FOUND", () => {
      expect(sourceErrorMessage(apiErr("LIST_NOT_FOUND"), "fallback", "creation")).toBe(
        "We couldn't find that Letterboxd list. Check the URL and try again.",
      );
    });

    it("uses make-it-public phrasing for LIST_NOT_AVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("LIST_NOT_AVAILABLE"), "fallback", "creation")).toBe(
        "That list isn't public. Make it public on Letterboxd and try again.",
      );
    });
  });

  it("falls through to the error message for unrecognized codes", () => {
    expect(sourceErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("uses the fallback for unknown thrown values", () => {
    expect(sourceErrorMessage("string", "Couldn't refresh")).toBe("Couldn't refresh");
  });
});
