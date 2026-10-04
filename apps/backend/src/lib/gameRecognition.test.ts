import { describe, expect, it, vi } from "vitest";
import {
  buildFingerprint,
  catalogGameNamedBy,
  fitToBudget,
  isUsableExample,
  type JudgeRequest,
  labelsForGame,
  linksElsewhere,
  matchByUrlOrLabel,
  type RecognitionCandidate,
  type RecognitionTrace,
  rankByFingerprint,
  recognizeGame,
  selectExamples,
  shapeTokens,
  textContainsGameUrl,
} from "./gameRecognition.js";

const game = (id: string, title: string, normalizedUrl: string): RecognitionCandidate => ({
  id,
  title,
  normalizedUrl,
});

const maptap = game("maptap", "MapTap", "maptap.gg");
const dailyTens = game("dailytens", "Daily Tens", "dailytens.com");
const wordle = game("wordle", "Wordle", "nytimes.com/games/wordle");
const worldle = game("worldle", "Worldle", "worldle.teuteuf.fr");
const tradle = game("tradle", "Tradle", "tradle.net");
const satle = game("satle", "Satle", "satle.ca");
const mini = game("mini", "NYT Mini", "nytimes.com/crosswords/game/mini");
const connections = game("connections", "Connections", "nytimes.com/games/connections");
const geosports = game("geosports", "GeoSports", "geosports.app");
const geohistory = game("geohistory", "GeoHistory", "geohistory.gg");
const krillion = game("krillion", "Krillion · the daily dive", "krillion.io");
const ALL = [
  maptap,
  dailyTens,
  wordle,
  worldle,
  tradle,
  satle,
  mini,
  connections,
  geosports,
  geohistory,
  krillion,
];

const MAPTAP_SHARE = "www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770";
const miniShare = (date: string, time: string) =>
  `I solved the ${date} New York Times Mini Crossword in ${time}!`;
const MINI_EXAMPLES = [
  `${miniShare("5/20/2026", "0:16")}\nhttps://www.nytimes.com/crosswords/game/mini`,
  miniShare("5/21/2026", "1:02"),
  `${miniShare("5/22/2026", "0:48")}\nhttps://www.nytimes.com/crosswords/game/mini`,
  miniShare("5/23/2026", "2:10"),
];
const geoShare = (name: string, site: string, score: number) =>
  `${name} · Oct 2nd\n${score} / 1,000\n🟢🟡🟡🟢🟡\n${site}`;

describe("textContainsGameUrl", () => {
  it("matches a host with or without scheme and www", () => {
    expect(textContainsGameUrl("www.maptap.gg may 27", "maptap.gg")).toBe(true);
    expect(textContainsGameUrl("play at https://maptap.gg.", "maptap.gg")).toBe(true);
    expect(textContainsGameUrl("https://dailytens.com/?ref=1", "dailytens.com")).toBe(true);
  });

  it("does not match another site that merely contains the host", () => {
    expect(textContainsGameUrl("https://bigmaptap.gg", "maptap.gg")).toBe(false);
    expect(textContainsGameUrl("https://maptap.gg.evil.com", "maptap.gg")).toBe(false);
    expect(textContainsGameUrl("https://maptap.ggg", "maptap.gg")).toBe(false);
  });

  it("requires the path for a game that lives under one", () => {
    const text = "https://www.nytimes.com/crosswords/game/mini";
    expect(textContainsGameUrl(text, mini.normalizedUrl)).toBe(true);
    expect(textContainsGameUrl(text, wordle.normalizedUrl)).toBe(false);
    expect(textContainsGameUrl("https://hbd.gg/play/!", "hbd.gg/play")).toBe(true);
    expect(textContainsGameUrl("https://hbd.gg/players", "hbd.gg/play")).toBe(false);
  });
});

describe("labelsForGame", () => {
  it("uses the first title segment and the name a wholly-owned domain carries", () => {
    expect(labelsForGame(krillion)).toEqual(["krillion"]);
    expect(labelsForGame(dailyTens)).toEqual(["dailytens"]);
    expect(
      labelsForGame(game("g", "Size It Up | Magnitudle", "magnitudle.com/size-it-up")),
    ).toEqual(["sizeitup"]);
  });

  it("never answers to a shared host, a short name or a generic word", () => {
    expect(labelsForGame(wordle)).toEqual(["wordle"]);
    expect(labelsForGame(worldle)).toEqual(["worldle"]);
    expect(labelsForGame(game("g", "GG", "gg.com"))).toEqual([]);
    expect(labelsForGame(game("g", "Daily", "daily.example.com"))).toEqual([]);
  });
});

describe("matchByUrlOrLabel", () => {
  it("recognizes a share by its link", () => {
    expect(matchByUrlOrLabel(MAPTAP_SHARE, ALL).result).toEqual({
      gameId: "maptap",
      confidence: 0.99,
      method: "url",
    });
  });

  it("recognizes a share by its name, across spacing and punctuation", () => {
    const share = "DailyTens #751\n\n     🏆    ❌\n     🏆    🏆";
    expect(matchByUrlOrLabel(share, ALL).result).toMatchObject({
      gameId: "dailytens",
      method: "label",
    });
    expect(matchByUrlOrLabel("Krillion #77 🦐\n305\n\n🏮🐟🫧", ALL).result?.gameId).toBe(
      "krillion",
    );
  });

  it("keeps the Wordle family apart", () => {
    const pick = (text: string) => matchByUrlOrLabel(text, ALL).result?.gameId;
    expect(pick("Wordle 1,127 3/6\n\n⬜🟨⬜⬜⬜\n🟩🟩🟩🟩🟩")).toBe("wordle");
    expect(pick("#Worldle #1714 (01.10.2026) 3/6 (100%)\n🟩🟩🟩🟩🟩🎉")).toBe("worldle");
    expect(pick("#Tradle #1671 1/6\n🟩🟩🟩🟩🟩\nhttps://tradle.net/")).toBe("tradle");
    expect(pick("🛰Satle #468 6/6\n🟥🟥🟥🟥🟥🟩\nhttps://satle.ca")).toBe("satle");
  });

  it("matches names on word boundaries only", () => {
    // "was at least" squashes to "...wasatleast..." which contains "satle".
    expect(matchByUrlOrLabel("it was at least 3 tries", ALL).result).toBeNull();
  });

  it("does not treat a bare name in prose as a score", () => {
    expect(matchByUrlOrLabel("anyone playing wordle today?", ALL).result).toBeNull();
    expect(matchByUrlOrLabel("I hate connections so much", ALL).result).toBeNull();
  });

  it("reports every game the text names when it names more than one", () => {
    const recap = `${MAPTAP_SHARE}\n\nWordle 1,127 3/6`;
    const match = matchByUrlOrLabel(recap, ALL);
    expect(match.result).toBeNull();
    expect(match.hits.sort()).toEqual(["maptap", "wordle"]);
  });

  it("prefers the more specific of two nested names", () => {
    const sports = game("sports", "Connections Sports Edition", "example.com/connections-sports");
    const match = matchByUrlOrLabel("Connections Sports Edition\nPuzzle #12\n🟨🟨🟨🟨", [
      connections,
      sports,
    ]);
    expect(match.result?.gameId).toBe("sports");
  });
});

describe("catalogGameNamedBy", () => {
  it("admits any catalog game by link but only curated games by name", () => {
    const squatter = game("squatter", "Final Score", "example.org");
    const headerless = "98🎯 95🏅 92🏆 91👑 99🎯\nFinal score: 947";
    expect(catalogGameNamedBy(headerless, squatter, false)).toBe(false);
    expect(catalogGameNamedBy(headerless, squatter, true)).toBe(true);
    expect(catalogGameNamedBy("Final score 3 https://example.org", squatter, false)).toBe(true);
  });
});

describe("fingerprint", () => {
  it("is blind to the day's numbers and to line order", () => {
    const a = shapeTokens("GeoSports · Oct 12th\n616 / 1,000\n🏆🟡🔴");
    const b = shapeTokens("GeoSports · Oct 13th\n🏆🔴🟡\n794 / 1,000");
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("leaves links out so a share without its usual URL still matches", () => {
    expect(shapeTokens("https://www.nytimes.com/crosswords/game/mini").size).toBe(0);
  });

  it("keeps only the tokens most examples share", () => {
    const fingerprint = buildFingerprint(MINI_EXAMPLES);
    expect(fingerprint.has("w:crossword")).toBe(true);
    expect(fingerprint.has("n:9/9/9")).toBe(true);
    expect(fingerprint.has("w:nytimes")).toBe(false);
  });

  it("ranks the game whose shape the text carries first", () => {
    const examples = new Map([
      ["mini", MINI_EXAMPLES],
      ["maptap", [MAPTAP_SHARE]],
    ]);
    const ranked = rankByFingerprint(miniShare("6/01/2026", "0:13"), [maptap, mini], examples);
    expect(ranked[0]).toMatchObject({ gameId: "mini", score: 1 });
    expect(ranked[1]?.score).toBe(0);
  });
});

describe("examples", () => {
  it("rejects hand-typed non-results", () => {
    for (const junk of ["hi", ":/", "Failed", "(Cheated)", "Gave up", "5/10"]) {
      expect(isUsableExample(junk)).toBe(false);
    }
    expect(isUsableExample(MAPTAP_SHARE)).toBe(true);
  });

  it("drops junk, duplicates and another game's score filed by mistake", () => {
    const stored = [
      "hi",
      geoShare("GeoSports", "www.geosports.app", 616),
      geoShare("GeoSports", "www.geosports.app", 616),
      MAPTAP_SHARE,
      geoShare("GeoSports", "www.geosports.app", 794),
    ];
    expect(selectExamples(geosports, stored, ALL)).toEqual([
      geoShare("GeoSports", "www.geosports.app", 616),
      geoShare("GeoSports", "www.geosports.app", 794),
    ]);
  });
});

describe("fitToBudget", () => {
  it("gives every game its newest example before any game a second one", () => {
    const games = [
      { id: "a", name: "A", url: "a.com", examples: ["aaaa", "aaaa", "aaaa"] },
      { id: "b", name: "B", url: "b.com", examples: ["bbbb", "bbbb"] },
    ];
    expect(fitToBudget(games, 12).map((g) => g.examples.length)).toEqual([2, 1]);
    expect(fitToBudget(games, 1000).map((g) => g.examples.length)).toEqual([3, 2]);
  });
});

describe("linksElsewhere", () => {
  it("flags a text that links a site the game's shares never carry", () => {
    const examples = [geoShare("GeoHistory", "www.geohistory.gg", 887)];
    expect(
      linksElsewhere(geoShare("GeoSports", "www.geosports.app", 616), geohistory, examples),
    ).toBe(true);
    expect(
      linksElsewhere(geoShare("GeoHistory", "www.geohistory.gg", 700), geohistory, examples),
    ).toBe(false);
    expect(linksElsewhere("917 / 1,000\n🟢📜🟡🟡🟢", geohistory, examples)).toBe(false);
  });

  it("learns a game's alternate share domain from its examples", () => {
    const examples = ["#Tradle #100 3/6\n🟩🟩🟩🟩🟩\nhttps://oec.world/en/games/tradle"];
    expect(linksElsewhere("🟩🟩🟩🟩🟩 https://oec.world/en/games/tradle", tradle, examples)).toBe(
      false,
    );
  });
});

describe("recognizeGame", () => {
  const loadExamples = (examples: Record<string, string[]>) =>
    vi.fn(async () => new Map(Object.entries(examples)));

  it("answers from the link or name without loading examples or calling the judge", async () => {
    const load = loadExamples({});
    const judge = vi.fn();
    const result = await recognizeGame(MAPTAP_SHARE, ALL, { loadExamples: load, judge });
    expect(result).toEqual({ gameId: "maptap", confidence: 0.99, method: "url" });
    expect(load).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
  });

  it("recognizes a nameless share from the game's stored examples, without the judge", async () => {
    const judge = vi.fn();
    const result = await recognizeGame(miniShare("6/01/2026", "0:13"), ALL, {
      loadExamples: loadExamples({ mini: MINI_EXAMPLES, maptap: [MAPTAP_SHARE] }),
      judge,
    });
    expect(result).toMatchObject({ gameId: "mini", method: "fingerprint" });
    expect(result?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(judge).not.toHaveBeenCalled();
  });

  it("asks the judge when the shape is not decisive, with a fingerprint-ranked shortlist", async () => {
    const judge = vi.fn(async () => ({ probabilities: { maptap: 0.9, satle: 0.02 } }));
    const trace: RecognitionTrace = {};
    const headerless = "98🎯 95🏅 92🏆 91👑 99🎯\nFinal score: 947";
    const result = await recognizeGame(headerless, [satle, maptap], {
      loadExamples: loadExamples({
        maptap: [MAPTAP_SHARE],
        satle: ["🛰Satle #468 6/6\n🟥🟥🟥🟥🟥🟩"],
      }),
      judge,
      trace,
    });
    expect(result).toEqual({ gameId: "maptap", confidence: 0.9, method: "jev" });
    expect(trace.shortlist?.[0]).toBe("maptap");
    expect(judge).toHaveBeenCalledWith({
      text: headerless,
      games: [
        { id: "maptap", name: "MapTap", url: "maptap.gg", examples: [MAPTAP_SHARE] },
        {
          id: "satle",
          name: "Satle",
          url: "satle.ca",
          examples: ["🛰Satle #468 6/6\n🟥🟥🟥🟥🟥🟩"],
        },
      ],
    });
  });

  it("shows the judge a balanced number of examples per game", async () => {
    const judge = vi.fn(async () => null);
    const many = Array.from({ length: 20 }, (_, i) => `🛰Satle #${400 + i} 3/6\n🟥🟥🟩⬜⬜⬜`);
    await recognizeGame("98🎯 95🏅 92🏆 91👑 99🎯\nFinal score: 947", [satle, maptap], {
      loadExamples: loadExamples({ maptap: [MAPTAP_SHARE], satle: many }),
      judge,
    });
    const sent = (judge.mock.calls[0] as unknown as [JudgeRequest])[0];
    expect(sent.games.map((g) => [g.id, g.examples.length]).sort()).toEqual([
      ["maptap", 1],
      ["satle", 5],
    ]);
  });

  it("degrades to no detection when the judge throws, returns null or is unsure", async () => {
    const options = { loadExamples: loadExamples({ maptap: [MAPTAP_SHARE] }) };
    const text = "98🎯 95🏅 92🏆 91👑 99🎯\nFinal score: 947";
    const failing = vi.fn(async () => {
      throw new Error("jev down");
    });
    const trace: RecognitionTrace = {};
    expect(await recognizeGame(text, [maptap], { ...options, judge: failing, trace })).toBeNull();
    expect(trace.judgeFailed).toBe(true);
    expect(await recognizeGame(text, [maptap], { ...options, judge: async () => null })).toBeNull();
    const unsure = async () => ({ probabilities: { maptap: 0.3 } });
    expect(await recognizeGame(text, [maptap], { ...options, judge: unsure })).toBeNull();
  });

  it("degrades to no detection when examples cannot be loaded", async () => {
    const judge = vi.fn();
    const result = await recognizeGame("98🎯 95🏅\nFinal score: 947", [maptap], {
      loadExamples: async () => {
        throw new Error("db down");
      },
      judge,
    });
    expect(result).toBeNull();
    expect(judge).not.toHaveBeenCalled();
  });

  it("never sends text with nothing result-like in it to the judge", async () => {
    const judge = vi.fn();
    const options = { loadExamples: loadExamples({ maptap: [MAPTAP_SHARE] }), judge };
    for (const text of ["hi", "Gave up", "lol nice"]) {
      expect(await recognizeGame(text, [maptap], options)).toBeNull();
    }
    expect(judge).not.toHaveBeenCalled();
  });

  it("rejects a judge pick the text's own link contradicts", async () => {
    // A GeoSports share, pasted by someone who only has its sister game.
    const judge = vi.fn(async () => ({ probabilities: { geohistory: 0.92 } }));
    const trace: RecognitionTrace = {};
    const result = await recognizeGame(
      geoShare("GeoSports", "www.geosports.app", 616),
      [geohistory, maptap],
      {
        loadExamples: loadExamples({
          geohistory: [geoShare("GeoHistory", "www.geohistory.gg", 887)],
        }),
        judge,
        trace,
      },
    );
    expect(result).toBeNull();
    expect(trace.bestGuess).toMatchObject({ gameId: "geohistory" });
  });

  it("returns null for empty text or no candidates", async () => {
    expect(await recognizeGame("   ", ALL)).toBeNull();
    expect(await recognizeGame(MAPTAP_SHARE, [])).toBeNull();
  });
});
