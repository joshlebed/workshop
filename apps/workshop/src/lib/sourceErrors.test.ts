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
        "That isn't a Spotify playlist link. Check it and try again.",
      );
    });

    it("returns the not-available copy for PLAYLIST_NOT_AVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("PLAYLIST_NOT_AVAILABLE"), "fallback")).toBe(
        "The linked playlist is private or deleted. Make it public on Spotify, then sync again.",
      );
    });

    it("returns the upstream copy for SPOTIFY_UNAVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("SPOTIFY_UNAVAILABLE"), "fallback")).toBe(
        "Spotify isn't responding. Try again in a moment.",
      );
    });
  });

  describe("spotify, creation context", () => {
    it("uses make-it-public phrasing for PLAYLIST_NOT_AVAILABLE (no settings yet)", () => {
      expect(sourceErrorMessage(apiErr("PLAYLIST_NOT_AVAILABLE"), "fallback", "creation")).toBe(
        "That playlist isn't public. Make it public on Spotify and try again.",
      );
    });

    it("uses the same not-responding phrasing for SPOTIFY_UNAVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("SPOTIFY_UNAVAILABLE"), "fallback", "creation")).toBe(
        "Spotify isn't responding. Try again in a moment.",
      );
    });

    it("matches the settings copy for INVALID_PLAYLIST_URL", () => {
      expect(sourceErrorMessage(apiErr("INVALID_PLAYLIST_URL"), "fallback", "creation")).toBe(
        "That isn't a Spotify playlist link. Check it and try again.",
      );
    });
  });

  describe("letterboxd, settings context (default)", () => {
    it("returns the invalid-URL copy for INVALID_LETTERBOXD_URL", () => {
      expect(sourceErrorMessage(apiErr("INVALID_LETTERBOXD_URL"), "fallback")).toBe(
        "That isn't a Letterboxd list link. Check it and try again.",
      );
    });

    it("returns the not-found copy for LIST_NOT_FOUND", () => {
      expect(sourceErrorMessage(apiErr("LIST_NOT_FOUND"), "fallback")).toBe(
        "Couldn't find the linked Letterboxd list. Check that it still exists.",
      );
    });

    it("returns the not-available copy for LIST_NOT_AVAILABLE", () => {
      expect(sourceErrorMessage(apiErr("LIST_NOT_AVAILABLE"), "fallback")).toBe(
        "The linked Letterboxd list is private or deleted. Make it public on Letterboxd, then sync again.",
      );
    });

    it("returns the upstream copy for LIST_FETCH_FAILED", () => {
      expect(sourceErrorMessage(apiErr("LIST_FETCH_FAILED"), "fallback")).toBe(
        "Letterboxd isn't responding. Try again in a moment.",
      );
    });
  });

  describe("letterboxd, creation context", () => {
    it("uses check-the-link phrasing for LIST_NOT_FOUND", () => {
      expect(sourceErrorMessage(apiErr("LIST_NOT_FOUND"), "fallback", "creation")).toBe(
        "Couldn't find that Letterboxd list. Check the link and try again.",
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
