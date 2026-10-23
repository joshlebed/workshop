import { describe, expect, it } from "vitest";
import { highscorePath } from "./target";

describe("highscorePath", () => {
  it("defaults to the Games home", () => {
    expect(highscorePath({})).toBe("/");
    expect(highscorePath({ path: "g/abc" })).toBe("/g/abc");
    expect(highscorePath({ path: "/g/abc" })).toBe("/g/abc");
  });

  it("forwards a share payload as HighScore's /share params", () => {
    expect(highscorePath({ share: { text: "Wordle 1,234 3/6\n⬛🟩" } })).toBe(
      `/share?text=${encodeURIComponent("Wordle 1,234 3/6\n⬛🟩").replace(/%20/g, "+")}`,
    );
    expect(highscorePath({ share: { url: " https://x.gg/?ref=1 ", text: "" } })).toBe(
      "/share?url=https%3A%2F%2Fx.gg%2F%3Fref%3D1",
    );
    expect(highscorePath({ share: {} })).toBe("/share");
  });
});
