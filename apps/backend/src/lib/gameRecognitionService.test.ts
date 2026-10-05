import { describe, expect, it } from "vitest";
import { gameUrlKeysIn } from "./gameRecognitionService.js";

describe("gameUrlKeysIn", () => {
  it("yields the host, its parent domains and every leading path", () => {
    const keys = gameUrlKeysIn("solved it https://www.nytimes.com/crosswords/game/mini today");
    expect(keys).toEqual(
      expect.arrayContaining([
        "nytimes.com",
        "nytimes.com/crosswords",
        "nytimes.com/crosswords/game",
        "nytimes.com/crosswords/game/mini",
      ]),
    );
    expect(keys).not.toContain("com");
  });

  it("reads scheme-less links and drops sentence punctuation and queries", () => {
    expect(gameUrlKeysIn("www.maptap.gg October 4")).toContain("maptap.gg");
    expect(gameUrlKeysIn("Play now at https://hbd.gg/play/!")).toContain("hbd.gg/play");
    expect(gameUrlKeysIn("https://dailytens.com/?ref=1494585")).toContain("dailytens.com");
    expect(gameUrlKeysIn("see https://worldle.teuteuf.fr/share.")).toContain("worldle.teuteuf.fr");
  });

  it("offers a lowercased path next to the one the text carries", () => {
    expect(gameUrlKeysIn("https://Example.com/Daily/Game")).toEqual(
      expect.arrayContaining(["example.com/Daily/Game", "example.com/daily/game"]),
    );
  });

  it("finds nothing in text without links and stays bounded on a wall of them", () => {
    expect(gameUrlKeysIn("Wordle 1,127 3/6")).toEqual([]);
    const wall = Array.from({ length: 200 }, (_, i) => `https://site${i}.example.com/a/b/c`).join(
      " ",
    );
    expect(gameUrlKeysIn(wall).length).toBeLessThanOrEqual(64);
  });
});
