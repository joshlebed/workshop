// The ported registry code against the registry itself: for every fixture in
// the legacy parser / formatter test files, each game's stored `parse` and
// `format` must produce what its `spec` and `formatShareBody` produce today.
// The only differences allowed are the deliberate ones listed in builtin.ts,
// and each of those is pinned by its own test below.

import { formatShareBodyFallback, gameDefinitionForKey } from "@workshop/shared/gameRegistry";
import { evaluateScoreSpec } from "@workshop/shared/scoreParsing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_GAME_CODE, BUILTIN_GAMES } from "./builtin.js";
import { fixtureCorpus } from "./fixtureCorpus.js";
import { runFormat, runParse, shutdownGameCodeSandbox } from "./runtime.js";
import { scoreWithGameCode } from "./scoring.js";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test";
  process.env.SESSION_SECRET = "x".repeat(48);
});

afterAll(async () => {
  await shutdownGameCodeSandbox();
});

// Shares in the shapes prod actually holds, for the cases the legacy fixture
// files don't cover (the survey of prod `score_raw` found these).
const PROD_SHAPES = [
  "#Worldle #1663 (11.08.2026) 5/6 (100%)\n🔥 Current Win Streak: 1 days\n🟩🟩⬜⬜⬜↘️\n🟩🟨⬜⬜⬜↙️\n🟩🟩🟩🟩🟩🎉\n\nhttps://worldle.teuteuf.fr",
  "#Worldle #1660 (08.08.2026) X/6 (96%)\n🔥 Current Win Streak: 0 days\n🟩🟨⬜⬜⬜➡️\n🟩🟩🟩🟨⬜↘️\nhttps://worldle.teuteuf.fr",
  "#travle #1262 (2 away)\n🟧✅🟧🟧🟧🟧🟧\nhttps://travle.earth",
  "#travle #1280 +3 (2 hints)\n✅🟧✅🟥✅\nhttps://travle.earth",
  "#travle_practice +2\n✅✅✅🟥✅\nhttps://travle.earth/practice?r=g_AGO_AZE",
  "🛰Satle #501 X/6\n🟥🟥🟥🟥🟥🟥\nhttps://satle.ca",
  "🟥🟥🟩⬜️⬜️⬜️ 3/6",
  "Wordle 1,402 4/6*\n\n⬛🟨⬛⬛⬛\n🟩🟩🟩🟩🟩",
  "GeoSports · August 3rd\n842 / 1,000\n🟢🟢🟡🟢🔴\nwww.geosports.app",
  "Krillion #81 🦐\n415\n\n🦑🫧🏮🐟🦑🦑🫧",
  "MapTap.gg - Daily Geography Game",
  "(Cheated)",
  ":/",
];

const corpus = [...new Set([...fixtureCorpus(), ...PROD_SHAPES])];

/** The registry regex had no room for the date; the stored code reads it. */
function isDatedWorldle(raw: string): boolean {
  return /Worldle\s*#?\d+\s+\([\d./-]+\)\s+\d+\/6/i.test(raw);
}

describe("corpus", () => {
  it("is drawn from the legacy fixture files", () => {
    expect(corpus.length).toBeGreaterThan(300);
    expect(corpus.some((raw) => raw.includes("Final score: 938"))).toBe(true);
  });
});

describe("stored parse code reproduces the registry spec", () => {
  for (const { def, code } of BUILTIN_GAMES) {
    const { spec } = def;
    const parseCode = code.parse;
    if (!spec || parseCode === null) continue;
    it(`${def.key}: same score on every fixture`, async () => {
      const differences: string[] = [];
      let scores = 0;
      for (const raw of corpus) {
        const old = evaluateScoreSpec(spec, raw).value;
        const next = await runParse(parseCode, raw);
        if (old !== null) scores += 1;
        const same =
          old === null ? next.kind !== "score" : next.kind === "score" && next.value === old;
        if (same) continue;
        if (def.key === "worldle" && old === null && isDatedWorldle(raw)) continue;
        differences.push(`${JSON.stringify(raw)}: registry ${old}, code ${JSON.stringify(next)}`);
      }
      expect(differences).toEqual([]);
      // Every game has at least one fixture it really parses.
      expect(scores).toBeGreaterThan(0);
    });
  }
});

describe("stored format code reproduces the registry formatter", () => {
  for (const { def, code } of BUILTIN_GAMES) {
    const formatter = def.formatShareBody;
    const formatCode = code.format;
    it(`${def.key}: ${formatter ? "same summary on every fixture" : "has no formatter"}`, async () => {
      if (!formatter || formatCode === null) {
        expect(formatter === undefined && formatCode === null).toBe(true);
        return;
      }
      const differences: string[] = [];
      let summaries = 0;
      for (const raw of corpus) {
        // The display chain treats a blank formatter result like null.
        const old = formatter(raw)?.trim() ? formatter(raw) : null;
        const next = await runFormat(formatCode, raw);
        const text = next.kind === "summary" ? next.text : null;
        if (old !== null) summaries += 1;
        if (next.kind === "failed" || text !== old) {
          differences.push(
            `${JSON.stringify(raw)}: registry ${JSON.stringify(old)}, code ${JSON.stringify(next)}`,
          );
        }
      }
      expect(differences).toEqual([]);
      expect(summaries).toBeGreaterThan(0);
    });
  }
});

describe("deliberate differences from the registry", () => {
  const parse = (key: keyof typeof BUILTIN_GAME_CODE, raw: string) => {
    const code = BUILTIN_GAME_CODE[key]?.parse;
    if (!code) throw new Error(`no parse code for ${key}`);
    return runParse(code, raw);
  };

  it("Worldle parses the dated share the registry regex could not", async () => {
    const dated = PROD_SHAPES[0] as string;
    const spec = gameDefinitionForKey("worldle")?.spec;
    expect(spec && evaluateScoreSpec(spec, dated).value).toBe(null);
    expect(await parse("worldle", dated)).toEqual({ kind: "score", value: 5 });
    // The undated shape the registry tests use still parses.
    expect(await parse("worldle", "#Worldle #842 3/6 (100%)\n🟩🟩🟩🟨⬜")).toEqual({
      kind: "score",
      value: 3,
    });
  });

  it.each([
    ["wordle", "Wordle 1,127 X/6\n\n🟨⬛⬛⬛⬛"],
    ["worldle", PROD_SHAPES[1] as string],
    ["worldle", "#Worldle #842 X/6 (60%)\n🟩🟨⬜⬜⬜"],
    ["tradle", "#Tradle #1557 X/6\n🟩🟩🟩⬜⬜\nhttps://tradle.net/"],
    ["satle", PROD_SHAPES[5] as string],
    ["travle", PROD_SHAPES[2] as string],
    ["framed", "Framed #1234\n🎥 🟥 🟥 🟥 🟥 🟥 🟥"],
  ] as const)("%s: a loss is an explicit no-result, not a failure", async (key, raw) => {
    expect(await parse(key, raw)).toEqual({ kind: "noResult" });
  });

  it.each([
    ["satle", ":/"],
    ["satle", "🟥🟥🟩⬜️⬜️⬜️ 3/6"],
    ["travle", "#travle_practice +2\n✅✅✅🟥✅\nhttps://travle.earth/practice?r=g_AGO_AZE"],
    ["globle", "(Cheated)"],
    ["maptap", "MapTap.gg - Daily Geography Game"],
    ["dailytens", "https://dailytens.com/?ref=944415"],
    ["geosports", "DailyTens #781\n\n     🏆    ❌\n     🏆    🏆"],
    ["framed", "Framed #1234"],
    ["connections", "Connections\nPuzzle #745"],
    ["strands", "Strands #100"],
    ["nyt-mini", "MapTap.gg - Daily Geography Game"],
    ["spelling-bee", "I just hit Legend on Spelling Bee."],
    ["wordle", "Wordle"],
  ] as const)("%s: text it cannot read fails instead of guessing", async (key, raw) => {
    expect(await parse(key, raw)).toMatchObject({ kind: "failed", reason: "threw" });
  });

  it("never reads a puzzle number, a date or a streak as the score", async () => {
    expect(await parse("wordle", "Wordle 1,127")).toMatchObject({ kind: "failed" });
    expect(
      await parse("nyt-mini", "I solved the 6/10/2026 New York Times Mini Crossword!"),
    ).toMatchObject({
      kind: "failed",
    });
    expect(await parse("worldle", "#Worldle #1663 (11.08.2026)")).toMatchObject({ kind: "failed" });
    expect(await parse("framed", "Framed #1234\n🎥 🟥 🟥 🟩 ⬛ ⬛ ⬛")).toEqual({
      kind: "score",
      value: 3,
    });
  });

  it("EthnoGuessr (detection-only in the registry) parses its headline average", async () => {
    const raw =
      "I scored an average of 3,197 over 10 rounds in today's EthnoGuessr! Can you beat my score of 5000 points on round 2? Play now at https://hbd.gg/play/!";
    expect(await parse("ethnoguessr", raw)).toEqual({ kind: "score", value: 3197 });
  });
});

describe("scoreWithGameCode", () => {
  const wordle = {
    parseCode: BUILTIN_GAME_CODE.wordle?.parse ?? null,
    formatCode: BUILTIN_GAME_CODE.wordle?.format ?? null,
  };
  const tradle = {
    parseCode: BUILTIN_GAME_CODE.tradle?.parse ?? null,
    formatCode: BUILTIN_GAME_CODE.tradle?.format ?? null,
  };

  it("stores a score with the formatter's summary", async () => {
    const raw = "#Tradle #1558 2/6\n🟩🟩🟩⬜⬜\n🟩🟩🟩🟩🟩\nhttps://tradle.net/";
    const scored = await scoreWithGameCode(tradle, raw);
    expect(scored).toMatchObject({
      parseStatus: "score",
      scoreValue: 2,
      scoreSummary: "🟩 3·5 2/6",
    });
  });

  it("stores a loss as no_result, still with a summary", async () => {
    const raw = "#Tradle #1557 X/6\n🟩🟩🟩⬜⬜\nhttps://tradle.net/";
    expect(await scoreWithGameCode(tradle, raw)).toMatchObject({
      parseStatus: "no_result",
      scoreValue: null,
      scoreSummary: "🟩 3 X/6",
    });
  });

  it("uses the cleaned raw text when the game has no formatter", async () => {
    const raw =
      "Wordle 1,127 3/6\n\n🟨⬛⬛⬛⬛\n🟩🟩🟩🟩🟩\nhttps://www.nytimes.com/games/wordle\n#wordle";
    const scored = await scoreWithGameCode(wordle, raw);
    expect(scored.parseStatus).toBe("score");
    expect(scored.scoreSummary).toBe(formatShareBodyFallback(raw));
    expect(scored.scoreSummary).toBe("Wordle 1,127 3/6\n🟨⬛⬛⬛⬛\n🟩🟩🟩🟩🟩");
    expect(scored.format).toBe(null);
  });

  it("stores unreadable text as failed with the cleaned text, never a guessed number", async () => {
    const scored = await scoreWithGameCode(tradle, "failed 12");
    expect(scored).toMatchObject({
      parseStatus: "failed",
      scoreValue: null,
      scoreSummary: "failed 12",
    });
  });

  it("an untaught game is failed with reason no_code — not the first number in the text", async () => {
    const scored = await scoreWithGameCode(
      { parseCode: null, formatCode: null },
      "Krillion #81 🦐\n415\n\n🦑🫧🏮🐟🦑🦑🫧",
    );
    expect(scored.parseStatus).toBe("failed");
    expect(scored.scoreValue).toBe(null);
    expect(scored.parse).toEqual({ kind: "failed", reason: "no_code" });
    expect(scored.scoreSummary).toBe("Krillion #81 🦐\n415\n🦑🫧🏮🐟🦑🦑🫧");
  });

  it("has no summary for a URL-only share", async () => {
    const dailyTens = {
      parseCode: BUILTIN_GAME_CODE.dailytens?.parse ?? null,
      formatCode: BUILTIN_GAME_CODE.dailytens?.format ?? null,
    };
    expect(await scoreWithGameCode(dailyTens, "https://dailytens.com/?ref=944415")).toMatchObject({
      parseStatus: "failed",
      scoreSummary: null,
    });
  });

  it("falls back to the cleaned text when the formatter crashes", async () => {
    const scored = await scoreWithGameCode(
      { parseCode: wordle.parseCode, formatCode: "function format(raw) { throw new Error('x'); }" },
      "Wordle 1,127 3/6",
    );
    expect(scored).toMatchObject({
      parseStatus: "score",
      scoreValue: 3,
      scoreSummary: "Wordle 1,127 3/6",
    });
    expect(scored.format).toMatchObject({ kind: "failed", reason: "threw" });
  });

  it("skips format when parse took the sandbox down, so one bad game costs one timeout", async () => {
    const startedAt = performance.now();
    const scored = await scoreWithGameCode(
      {
        parseCode: `function parse() { return ("a".repeat(200000) + "b").indexOf("a".repeat(100000) + "c"); }`,
        formatCode: `function format() { return ("a".repeat(200000) + "b").indexOf("a".repeat(100000) + "c") + ""; }`,
      },
      "x",
    );
    expect(scored).toMatchObject({ parseStatus: "failed", format: null, scoreSummary: "x" });
    expect(performance.now() - startedAt).toBeLessThan(450);
  });
});
