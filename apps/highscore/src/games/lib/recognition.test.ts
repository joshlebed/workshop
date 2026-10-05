import { describe, expect, it } from "vitest";
import type { RecognizedGameMatch } from "../api/recognition";
import { recognizedGameLabel, recognizedGameTarget, wrongGameMatch } from "./recognition";

const match = (over: Partial<RecognizedGameMatch> = {}): RecognizedGameMatch => ({
  game: { id: "g-maptap", title: "MapTap", url: "https://maptap.gg" },
  inMyGames: true,
  confidence: 0.99,
  method: "url",
  ...over,
});

describe("recognizedGameLabel", () => {
  it("uses the name, not the whole page title", () => {
    const geozee = match({
      game: {
        id: "g",
        title: "Geozee — Daily Geography Category Puzzle",
        url: "https://geozee.earth",
      },
    });
    expect(recognizedGameLabel(geozee)).toBe("Geozee");
    expect(recognizedGameLabel(match())).toBe("MapTap");
    const krillion = match({
      game: { id: "k", title: "Krillion · the daily dive", url: "https://krillion.io" },
    });
    expect(recognizedGameLabel(krillion)).toBe("Krillion");
  });
});

describe("recognizedGameTarget", () => {
  it("posts to the My Games row when the game is already there", () => {
    expect(recognizedGameTarget(match())).toEqual({
      gameId: "g-maptap",
      title: "MapTap",
      url: "https://maptap.gg",
    });
  });

  it("goes by URL for a catalog game not in My Games, so posting adds it", () => {
    expect(recognizedGameTarget(match({ inMyGames: false }))).toEqual({
      gameId: null,
      title: "MapTap",
      url: "https://maptap.gg",
    });
  });
});

describe("wrongGameMatch", () => {
  it("flags a score recognized as a different game", () => {
    expect(wrongGameMatch(match(), "g-krillion")).toEqual(match());
  });

  it("says nothing when recognition agrees, has no answer, or has no target", () => {
    expect(wrongGameMatch(match(), "g-maptap")).toBeNull();
    expect(wrongGameMatch(null, "g-krillion")).toBeNull();
    expect(wrongGameMatch(match(), undefined)).toBeNull();
  });
});
