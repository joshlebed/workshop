import { SCORE_SHAPE_FIXTURES } from "@workshop/shared/scoreShapeFixtures";
import { describe, expect, it } from "vitest";
import { checkScoreInput, isTitleOnlyShare } from "./inputGate.js";

const maptap = { id: "maptap", title: "MapTap", normalizedUrl: "maptap.gg" };
const tradle = { id: "tradle", title: "Tradle", normalizedUrl: "tradle.net" };
const mini = { id: "mini", title: "NYT Mini", normalizedUrl: "nytimes.com/crosswords/game/mini" };
const today = "2026-10-06";
const check = (raw: string, periodKey = today, games = [maptap, tradle, mini]) =>
  checkScoreInput({ raw, periodKey, today, games });

describe("checkScoreInput", () => {
  it("rejects empty and whitespace-only text", () => {
    expect(check("")).toBe("empty");
    expect(check("  \n ")).toBe("empty");
  });

  it("rejects a URL-only share", () => {
    expect(check("https://dailytens.com/?ref=944415")).toBe("url_only");
    expect(check("https://globle-game.com\n#globle")).toBe("url_only");
  });

  it("rejects a title-only share", () => {
    expect(check("MapTap.gg - Daily Geography Game")).toBe("title_only");
    expect(check("MapTap")).toBe("title_only");
    expect(check("Tradle | Guess the country\nhttps://tradle.net/")).toBe("title_only");
  });

  it("rejects text over the 2,000 character limit", () => {
    expect(check(`Final score: 812 ${"x".repeat(2000)}`)).toBe("too_long");
    expect(check(`Final score: 812 ${"x".repeat(1900)}`)).toBeNull();
  });

  it("rejects a day in the future but allows past days and a client ahead of UTC", () => {
    const raw = "Final score: 812";
    expect(check(raw, "2026-10-08")).toBe("future_day");
    expect(check(raw, "2026-10-07")).toBeNull();
    expect(check(raw, "2026-09-01")).toBeNull();
  });

  it("allows junk, hand-typed losses and notes — they post unread", () => {
    for (const raw of [":/", "hi", "wtf", "(Gave up)", "Failed", "Tradle failed", "(Cheated)"]) {
      expect(check(raw), raw).toBeNull();
    }
  });

  it("allows every prod share shape, with or without a hand-appended note", () => {
    for (const { raw, loss, title, normalizedUrl, key } of SCORE_SHAPE_FIXTURES) {
      const games = [{ id: key, title, normalizedUrl }];
      expect(check(raw, today, games), key).toBeNull();
      expect(check(`${raw}\nugh, so close`, today, games), key).toBeNull();
      if (loss) expect(check(loss, today, games), key).toBeNull();
    }
  });
});

describe("isTitleOnlyShare", () => {
  it("needs the name to be the whole first segment", () => {
    expect(isTitleOnlyShare("anyone playing MapTap today?", [maptap])).toBe(false);
    expect(isTitleOnlyShare("MapTap is down", [maptap])).toBe(false);
    expect(isTitleOnlyShare("MapTap: the daily geography game", [maptap])).toBe(true);
  });

  it("does not call a result with the name in it a title", () => {
    expect(isTitleOnlyShare("MapTap 812", [maptap])).toBe(false);
    expect(isTitleOnlyShare("MapTap 🔥", [maptap])).toBe(false);
  });

  it("only knows the games it is given", () => {
    expect(isTitleOnlyShare("Wordle", [maptap])).toBe(false);
  });
});
