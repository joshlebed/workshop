import { describe, expect, it } from "vitest";
import { GAME_REGEX_CATALOG, matchGameScoreRegex, SCORE_COUNT_PREFIX } from "./gameScoreRegex.js";

describe("matchGameScoreRegex", () => {
  it("identifies Daily Tens from its url (the self-heal path for the ?ref bug)", () => {
    const game = matchGameScoreRegex({ title: "Daily Tens", url: "https://dailytens.com/" });
    expect(game?.key).toBe("dailytens");
    expect(game?.scoreRegex).toBe(`${SCORE_COUNT_PREFIX}🏆`);
  });

  it("identifies a game from content.siteName / sourceId, not just title/url", () => {
    expect(matchGameScoreRegex({ siteName: "maptap.gg" })?.key).toBe("maptap");
    expect(matchGameScoreRegex({ sourceId: "globle-game.com/daily" })?.key).toBe("globle");
  });

  it("returns null for an item that doesn't match any known game", () => {
    expect(
      matchGameScoreRegex({ title: "My custom leaderboard", url: "https://example.com" }),
    ).toBe(null);
  });

  it("returns null when every field is empty/nullish", () => {
    expect(matchGameScoreRegex({})).toBe(null);
    expect(matchGameScoreRegex({ title: null, url: null, siteName: null, sourceId: null })).toBe(
      null,
    );
  });

  it("scores Daily Tens by counting 🏆, not the puzzle/ref number", () => {
    const dailytens = GAME_REGEX_CATALOG.find((g) => g.key === "dailytens");
    expect(dailytens?.scoreRegex).toBe(`${SCORE_COUNT_PREFIX}🏆`);
    expect(dailytens?.scoreDirection).toBe("desc");
    // The count is over 🏆 globally — the puzzle number (#751) and ?ref id are
    // ignored. End-to-end parsing is covered in scores.test.ts.
    const raw = "DailyTens #751\n\n     🏆    ❌\n     🏆    🏆\nhttps://dailytens.com/?ref=944415";
    const inner = dailytens?.scoreRegex.slice(SCORE_COUNT_PREFIX.length) ?? "";
    expect((raw.match(new RegExp(inner, "gu")) ?? []).length).toBe(3);
  });

  it("every catalog regex compiles; capture-mode entries expose a group", () => {
    for (const game of GAME_REGEX_CATALOG) {
      if (game.scoreRegex.startsWith(SCORE_COUNT_PREFIX)) {
        // count:<pattern> — the inner pattern must compile (applied with `gu`);
        // it has no capture group, the score is the match count.
        const inner = game.scoreRegex.slice(SCORE_COUNT_PREFIX.length);
        expect(() => new RegExp(inner, "gu")).not.toThrow();
      } else {
        // Throws if the source is an invalid pattern — the backend stores it
        // verbatim on items.score_regex and applies it with `new RegExp(p, "i")`.
        expect(() => new RegExp(game.scoreRegex, "i")).not.toThrow();
        // Capture group 1 is what the backend reads for the numeric score.
        expect(game.scoreRegex).toContain("(");
      }
    }
  });
});
