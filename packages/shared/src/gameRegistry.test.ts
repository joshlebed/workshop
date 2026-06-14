import { describe, expect, it } from "vitest";
import {
  CATALOG_GAME_DEFINITIONS,
  GAME_REGISTRY,
  gameDefinitionForKey,
  identifyGame,
  isResultlessShare,
  matchShareText,
} from "./gameRegistry.js";
import { normalizeGameUrl } from "./games.js";
import { parseScoreWithSpec } from "./scoreParsing.js";

/** Parse a share with a registry game's spec (test sugar). */
function parse(key: string, raw: string): number | null {
  const def = gameDefinitionForKey(key);
  if (!def?.spec) throw new Error(`no spec for ${key}`);
  return parseScoreWithSpec(def.spec, raw);
}

describe("registry shape", () => {
  it("every canonicalUrl normalizes to a usable dedup key", () => {
    for (const def of GAME_REGISTRY) {
      expect(normalizeGameUrl(def.canonicalUrl), def.key).toBeTruthy();
    }
  });

  it("keys are unique", () => {
    const keys = GAME_REGISTRY.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("wordle stays last so Worldle/Tradle never fall through to it", () => {
    expect(GAME_REGISTRY[GAME_REGISTRY.length - 1]?.key).toBe("wordle");
  });

  it("every catalog game has a spec (catalog implies parseable)", () => {
    for (const def of CATALOG_GAME_DEFINITIONS) {
      expect(def.spec, def.key).not.toBe(null);
    }
  });
});

// Share texts below are real prod shapes (sampled from game_scores.score_raw)
// unless noted.
describe("score parsing per game", () => {
  it("anthropeum captures the points before the `·`, not the date in the header", () => {
    expect(
      parse(
        "anthropeum",
        "Anthropeum.com · Jun 14 2026\n🟨🟨🟨🟨🟩🟦🟩🟥🟦🟩\n62,090 · top 38% of players today!",
      ),
    ).toBe(62090);
  });

  it("maptap", () => {
    expect(
      parse("maptap", "www.maptap.gg June 11\n94🎉 96🔥 95🏅 91👑 95🏆\nFinal score: 938"),
    ).toBe(938);
  });

  it("globle", () => {
    expect(
      parse(
        "globle",
        "🌎 Jun 11, 2026 🌍\n🔥 11 | Avg. Guesses: 6.85\n🟥🟥🟩 = 3\n\nhttps://globle-game.com\n#globle",
      ),
    ).toBe(3);
  });

  it("globle with a hand-typed marker after the score", () => {
    expect(parse("globle", "🟨🟨🟧🟥🟥🟩 = 13(cheated)\nhttps://globle-game.com")).toBe(13);
  });

  it("satle", () => {
    expect(parse("satle", "🛰Satle #369 4/6\n🟥🟥🟥🟩⬜⬜\nhttps://satle.ca")).toBe(4);
  });

  it("travle", () => {
    expect(parse("travle", "#travle #1275 +1\n✅✅✅🟧✅\nhttps://travle.earth")).toBe(1);
    expect(parse("travle", "#travle #1251 +0 (Perfect)\n✅✅✅\nhttps://travle.earth")).toBe(0);
  });

  it("wordle (and a failed X/6 has no score)", () => {
    expect(parse("wordle", "Wordle 1,127 3/6\n\n🟨⬛⬛⬛⬛\n🟩🟩🟩🟩🟩")).toBe(3);
    expect(parse("wordle", "Wordle 1,127 X/6\n\n🟨⬛⬛⬛⬛")).toBe(null);
  });

  it("worldle", () => {
    expect(parse("worldle", "#Worldle #842 3/6 (100%)\n🟩🟩🟩🟨⬜")).toBe(3);
  });

  it("tradle (and a failed X/6 has no score)", () => {
    expect(
      parse(
        "tradle",
        "#Tradle #1558 4/6\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟩🟨\n🟩🟩🟩🟩🟨\n🟩🟩🟩🟩🟩\nhttps://tradle.net/",
      ),
    ).toBe(4);
    expect(parse("tradle", "#Tradle #1557 X/6\n🟩🟩🟩⬜⬜\nhttps://tradle.net/")).toBe(null);
  });

  it("dailytens counts 🏆, scores all-❌ as 0, and a URL-only share as null", () => {
    const grid =
      "https://dailytens.com/?ref=987694\nDailyTens #766\n\n     🏆    🏆\n     🏆    🏆\n     🏆    ❌\n     ❌    ❌\n     🏆    🏆";
    expect(parse("dailytens", grid)).toBe(7);
    expect(parse("dailytens", "DailyTens #1\n❌ ❌")).toBe(0);
    expect(parse("dailytens", "https://dailytens.com/?ref=944415")).toBe(null);
  });

  it("geosports (comma-formatted perfect round parses to 1000)", () => {
    expect(
      parse("geosports", "GeoSports · June 11th\n🟡🟡🔴🟡🟢\n711 / 1,000\nwww.geosports.app"),
    ).toBe(711);
    expect(parse("geosports", "GeoSports · June 12th\n🟢🟢🟢🟢🟢\n1,000 / 1,000")).toBe(1000);
  });

  it("framed scores by guess position, not the puzzle number", () => {
    expect(parse("framed", "Framed #1234\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛\nhttps://framed.wtf")).toBe(3);
    expect(parse("framed", "Framed #1234\n🎥 🟩 ⬛ ⬛ ⬛ ⬛ ⬛")).toBe(1);
    // A loss has no numeric score (was: everyone tied on the puzzle number).
    expect(parse("framed", "Framed #1234\n🎥 🟥 🟥 🟥 🟥 🟥 🟥")).toBe(null);
  });

  it("nyt-mini parses the solve time in seconds, not the date", () => {
    expect(parse("nyt-mini", "I solved the 6/10/2026 New York Times Mini Crossword in 0:30!")).toBe(
      30,
    );
    expect(
      parse(
        "nyt-mini",
        "I solved the 6/10/2026 New York Times Mini Crossword in 1:05!\nhttps://www.nytimes.com/crosswords/game/mini",
      ),
    ).toBe(65);
  });

  it("connections counts guess rows", () => {
    expect(
      parse("connections", "Connections\nPuzzle #745\n🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟪🟪🟪🟪"),
    ).toBe(4);
  });

  it("strands counts hints, perfect game scores 0, gridless yields null", () => {
    expect(parse("strands", 'Strands #432\n"Today\'s theme"\n💡🔵🔵🟡\n🔵🔵🔵🔵')).toBe(1);
    expect(parse("strands", "Strands #432\n🔵🔵🟡🔵\n🔵🔵🔵🔵")).toBe(0);
    expect(parse("strands", "https://www.nytimes.com/games/strands")).toBe(null);
  });

  it("spelling-bee maps the rank word", () => {
    expect(parse("spelling-bee", "I just hit Genius on Spelling Bee.")).toBe(9);
    expect(parse("spelling-bee", "I just hit Queen Bee on Spelling Bee!")).toBe(10);
  });
});

describe("share-text detection", () => {
  const cases: [string, string][] = [
    [
      "anthropeum",
      "Anthropeum.com · Jun 14 2026\n🟨🟨🟨🟨🟩🟦🟩🟥🟦🟩\n62,090 · top 38% of players today!",
    ],
    ["maptap", "www.maptap.gg June 11\nFinal score: 938"],
    ["dailytens", "DailyTens #766\n🏆 ❌"],
    ["satle", "🛰Satle #369 4/6"],
    ["travle", "#travle #1275 +1"],
    ["globle", "🟥🟥🟩 = 3\nhttps://globle-game.com\n#globle"],
    ["worldle", "#Worldle #842 3/6 (100%)"],
    ["tradle", "#Tradle #1558 4/6"],
    ["geosports", "GeoSports · June 11th\n711 / 1,000"],
    ["framed", "Framed #1234\n🎥 🟥 🟩"],
    ["heardle", "#Heardle #123"],
    ["connections", "Connections\nPuzzle #745\n🟨🟨🟨🟨"],
    ["strands", 'Strands #432\n"Today\'s theme"'],
    ["nyt-mini", "I solved the 6/10/2026 New York Times Mini Crossword in 0:30!"],
    ["spelling-bee", "I just hit Genius on Spelling Bee."],
    ["wordle", "Wordle 1,127 3/6"],
  ];

  it.each(cases)("%s share is detected as itself", (key, raw) => {
    expect(matchShareText(raw)?.key).toBe(key);
  });

  it("Worldle and Tradle don't fall through to Wordle", () => {
    expect(matchShareText("#Worldle #842 3/6")?.key).toBe("worldle");
    expect(matchShareText("#Tradle #1558 4/6")?.key).toBe("tradle");
  });

  it("unknown text matches nothing", () => {
    expect(matchShareText("just some chat message with a 42 in it")).toBe(null);
  });
});

describe("identifyGame", () => {
  it("identifies from any identity field", () => {
    expect(identifyGame(["Daily Tens", "https://dailytens.com/"])?.key).toBe("dailytens");
    expect(identifyGame([null, null, "maptap.gg"])?.key).toBe("maptap");
    expect(identifyGame(["globle-game.com/daily"])?.key).toBe("globle");
  });

  it("identifies NYT Mini from its title", () => {
    expect(identifyGame(["NYT Mini", "https://www.nytimes.com/crosswords/game/mini"])?.key).toBe(
      "nyt-mini",
    );
  });

  it("returns null for unknown identity and empty input", () => {
    expect(identifyGame(["My custom leaderboard", "https://example.com"])).toBe(null);
    expect(identifyGame([])).toBe(null);
    expect(identifyGame([null, undefined])).toBe(null);
  });

  it("catalogOnly skips detection-only games", () => {
    expect(identifyGame(["Heardle"])?.key).toBe("heardle");
    expect(identifyGame(["Heardle"], { catalogOnly: true })).toBe(null);
  });
});

describe("isResultlessShare", () => {
  it("URL-only and hashtag-only shares are resultless", () => {
    expect(isResultlessShare("https://dailytens.com/?ref=944415")).toBe(true);
    expect(isResultlessShare("https://x.com/a\n#globle\n\n")).toBe(true);
    expect(isResultlessShare("")).toBe(true);
    expect(isResultlessShare(null)).toBe(true);
  });

  it("a real result is not resultless", () => {
    expect(isResultlessShare("Wordle 1,127 3/6\n🟩🟩🟩🟩🟩")).toBe(false);
  });
});

describe("formatShareBody", () => {
  it("anthropeum drops the url/date header, joins grid + score into one clean line", () => {
    const def = gameDefinitionForKey("anthropeum")!;
    expect(
      def.formatShareBody!(
        "Anthropeum.com · Jun 14 2026\n🟨🟨🟨🟨🟩🟦🟩🟥🟦🟩\n62,090 · top 38% of players today!",
      ),
    ).toBe("🟨🟨🟨🟨🟩🟦🟩🟥🟦🟩 62,090 · top 38% of players today!");
  });

  it("maptap drops the URL/date header, keeps rounds + final score", () => {
    const def = gameDefinitionForKey("maptap")!;
    expect(
      def.formatShareBody!("www.maptap.gg June 11\n94🎉 96🔥 95🏅 91👑 95🏆\nFinal score: 938"),
    ).toBe("94🎉 96🔥 95🏅 91👑 95🏆\nFinal score: 938");
  });

  it("dailytens transposes the 5×2 grid into two rows of five", () => {
    const def = gameDefinitionForKey("dailytens")!;
    const raw =
      "DailyTens #766\n\n     🏆    🏆\n     🏆    🏆\n     🏆    ❌\n     ❌    ❌\n     🏆    🏆";
    expect(def.formatShareBody!(raw)).toBe("🏆🏆🏆❌🏆\n🏆🏆❌❌🏆");
  });

  it("nyt-mini renders the time as keycap digits", () => {
    const def = gameDefinitionForKey("nyt-mini")!;
    expect(
      def.formatShareBody!("I solved the 6/10/2026 New York Times Mini Crossword in 0:30!"),
    ).toBe("0️⃣:3️⃣0️⃣");
  });

  it("geosports keeps the grid + score line", () => {
    const def = gameDefinitionForKey("geosports")!;
    expect(
      def.formatShareBody!(
        "GeoSports — Daily sports geography game\nGeoSports · June 11th\n🟡🟡🔴🟡🟢\n711 / 1,000\nwww.geosports.app",
      ),
    ).toBe("🟡🟡🔴🟡🟢\n711 / 1,000");
  });
});
