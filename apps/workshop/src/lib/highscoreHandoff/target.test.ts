import { describe, expect, it } from "vitest";
import { highscorePath, isIosUserAgent } from "./target";

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

describe("isIosUserAgent", () => {
  it("matches iPhone and iPad, and iPadOS-as-Mac only with touch", () => {
    expect(isIosUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)")).toBe(true);
    expect(isIosUserAgent("Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X)")).toBe(true);
    expect(isIosUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIosUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
    expect(isIosUserAgent("Mozilla/5.0 (Linux; Android 15)")).toBe(false);
  });
});
