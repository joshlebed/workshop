import { describe, expect, it } from "vitest";
import { InvalidPlaylistUrlError, parsePlaylistId } from "./playlist-parser.js";

describe("parsePlaylistId", () => {
  const id = "37i9dQZF1DXcBWIGoYBM5M"; // Spotify "Today's Top Hits" — known shape

  it("parses canonical https url", () => {
    expect(parsePlaylistId(`https://open.spotify.com/playlist/${id}`)).toBe(id);
  });

  it("parses url with si tracking query", () => {
    expect(parsePlaylistId(`https://open.spotify.com/playlist/${id}?si=abcdef`)).toBe(id);
  });

  it("parses embed variant", () => {
    expect(parsePlaylistId(`https://open.spotify.com/embed/playlist/${id}`)).toBe(id);
  });

  it("parses spotify URI scheme", () => {
    expect(parsePlaylistId(`spotify:playlist:${id}`)).toBe(id);
  });

  it("parses a bare id", () => {
    expect(parsePlaylistId(id)).toBe(id);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePlaylistId(`  https://open.spotify.com/playlist/${id}  `)).toBe(id);
  });

  it("rejects an empty string", () => {
    expect(() => parsePlaylistId("")).toThrow(InvalidPlaylistUrlError);
  });

  it("rejects a malformed url", () => {
    expect(() => parsePlaylistId("https://open.spotify.com/album/4SZko61aMnmgvNhfhgWqNn")).toThrow(
      InvalidPlaylistUrlError,
    );
  });

  it("rejects an id with the wrong length", () => {
    expect(() => parsePlaylistId("tooshort")).toThrow(InvalidPlaylistUrlError);
  });

  it("rejects garbage", () => {
    expect(() => parsePlaylistId("not a url")).toThrow(InvalidPlaylistUrlError);
  });
});
