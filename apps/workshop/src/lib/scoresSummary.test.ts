import type { Item } from "@workshop/shared";
import type { Game, GameStandingsEntry, MyGame } from "@workshop/shared/games";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTodaysGameScoresSummary,
  buildTodaysScoresSummary,
  summarizeGameScoreBody,
  summarizeScoreBody,
} from "./scoresSummary";

function item(id: string, title: string, url: string | null = null): Item {
  return {
    id,
    listId: "list-1",
    kind: "plain",
    title,
    url,
    note: null,
    content: {} as Item["content"],
    position: null,
    tags: [],
    addedBy: "user-1",
    completed: false,
    completedAt: null,
    completedBy: null,
    createdAt: "2026-05-22T00:00:00Z",
    updatedAt: "2026-05-22T00:00:00Z",
  };
}

function entry(
  userId: string,
  scoreRaw: string | null,
  scoreValue: number | null = null,
): GameStandingsEntry {
  return {
    userId,
    displayName: null,
    scoreRaw,
    scoreValue,
    updatedAt: "2026-05-22T12:00:00Z",
    rank: null,
    reactions: [],
  };
}

function game(id: string, title: string, url: string): Game {
  return {
    id,
    url,
    normalizedUrl: url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""),
    title,
    iconUrl: null,
    gameKey: null,
    scoreSpec: null,
    summarySpec: null,
    scoreDirection: "desc",
    createdAt: "2026-05-22T00:00:00Z",
  };
}

function myGame(id: string, title: string, url: string, entries: GameStandingsEntry[]): MyGame {
  return {
    gameId: id,
    position: null,
    addedAt: "2026-05-22T00:00:00Z",
    game: game(id, title, url),
    standings: {
      periodKey: "2026-05-27",
      entries,
      viewerHasPlayed: entries.some((e) => e.userId === "me"),
    },
  };
}

const LIST_URL = "https://workshop-a2v.pages.dev/list/list-1";
const FRIEND_URL = "https://workshop-a2v.pages.dev/friends/accept/invite123";

describe("summarizeScoreBody", () => {
  it("formats maptap by dropping the URL/date header", () => {
    const raw = "www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770";
    expect(summarizeScoreBody(item("a", "maptap", "https://maptap.gg/"), entry("u", raw))).toBe(
      "100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770",
    );
  });

  it("formats Globle as the grid line ending in `= N`", () => {
    const raw = [
      "🌎 May 27, 2026 🌍",
      "🔥 1 | Avg. Guesses: 8.4",
      "⬜🟨⬜🟧🟩 = 5",
      "",
      "https://globle-game.com",
      "#globle",
    ].join("\n");
    expect(
      summarizeScoreBody(item("a", "Globle", "https://globle-game.com/game"), entry("u", raw)),
    ).toBe("⬜🟨⬜🟧🟩 = 5");
  });

  it("preserves Globle multi-line grids that wrap at high guess counts", () => {
    const raw = [
      "🌎 May 18, 2026 🌍",
      "🔥 2 | Avg. Guesses: 7.12",
      "⬜⬜🟥🟧🟧🟥🟥🟥",
      "🟥🟥🟧🟩 = 12",
      "",
      "https://globle-game.com",
      "#globle",
    ].join("\n");
    expect(
      summarizeScoreBody(item("a", "Globle", "https://globle-game.com/game"), entry("u", raw)),
    ).toBe("⬜⬜🟥🟧🟧🟥🟥🟥\n🟥🟥🟧🟩 = 12");
  });

  // Real prod share: a player hand-typed `(cheated)` onto the grid's `= N` line.
  // The old `= N$`-anchored match missed it and dumped the whole date/avg header.
  it("keeps a Globle grid whose `= N` line carries a hand-typed `(cheated)` marker", () => {
    const raw = [
      "🌎 Jun 5, 2026 🌍",
      "🔥 5 | Avg. Guesses: 6.97",
      "⬜🟧🟥🟨🟧🟧🟥🟥",
      "🟥🟨🟧🟧🟩 = 13(cheated)",
      "",
      "https://globle-game.com",
      "#globle",
    ].join("\n");
    expect(
      summarizeScoreBody(item("a", "Globle", "https://globle-game.com/game"), entry("u", raw)),
    ).toBe("⬜🟧🟥🟨🟧🟧🟥🟥\n🟥🟨🟧🟧🟩 = 13(cheated)");
  });

  // Real prod share: the marker sits on the trailing hashtag line instead, while
  // the grid's `= 9` is clean — the grid block trims as usual, marker dropped.
  it("trims a Globle grid when `(cheated)` is on the hashtag line, not the score", () => {
    const raw = [
      "🌎 Jun 5, 2026 🌍",
      "🔥 3 | Avg. Guesses: 6.46",
      "⬜🟧🟨🟥🟧🟧🟥🟧",
      "🟩 = 9",
      "",
      "https://globle-game.com",
      "#globle (cheated)",
    ].join("\n");
    expect(
      summarizeScoreBody(item("a", "Globle", "https://globle-game.com/game"), entry("u", raw)),
    ).toBe("⬜🟧🟨🟥🟧🟧🟥🟧\n🟩 = 9");
  });

  // Single-line grid with the marker glued on: the grid line is also the score
  // line, so `isGridOnlyLine` must still recognize it past the `(cheated)` tail.
  it("keeps a single-line Globle grid with a `(cheated)` marker", () => {
    const raw = [
      "🌎 Jun 3, 2026 🌍",
      "🔥 1 | Avg. Guesses: 6",
      "🟨🟨🟥🟥🟥🟩 = 6(cheated)",
      "https://globle-game.com",
      "#globle",
    ].join("\n");
    expect(
      summarizeScoreBody(item("a", "Globle", "https://globle-game.com/game"), entry("u", raw)),
    ).toBe("🟨🟨🟥🟥🟥🟩 = 6(cheated)");
  });

  it("formats Satle as `<grid> <fraction>` from the `Satle #N N/6` header", () => {
    const raw = "🛰Satle #468 6/6\n🟥🟥🟥🟥🟥🟩\nhttps://satle.ca";
    expect(summarizeScoreBody(item("a", "Satle", "https://satle.ca/"), entry("u", raw))).toBe(
      "🟥🟥🟥🟥🟥🟩 6/6",
    );
  });

  it("formats travle as `<grid> +N` from the `#travle #N +N` header", () => {
    const raw = "#travle #1260 +2\n🟧✅🟩🟧🟩✅✅\nhttps://travle.earth";
    expect(summarizeScoreBody(item("a", "travle", "https://travle.earth"), entry("u", raw))).toBe(
      "🟧✅🟩🟧🟩✅✅ +2",
    );
  });

  it("keeps travle's `+0 (Perfect)` parenthetical", () => {
    const raw = "#travle #1251 +0 (Perfect)\n✅✅✅✅\nhttps://travle.earth";
    expect(summarizeScoreBody(item("a", "travle", "https://travle.earth"), entry("u", raw))).toBe(
      "✅✅✅✅ +0 (Perfect)",
    );
  });

  it("formats Daily Tens by transposing the 5×2 grid into two rows of five", () => {
    const raw = [
      "DailyTens #745",
      "",
      "      🏆    ❌",
      "      🏆    ❌",
      "      🏆    ❌",
      "      ❌    🏆",
      "      ❌    ❌ https://dailytens.com/?ref=954072",
    ].join("\n");
    // Left column (top→bottom) → first row; right column → second row.
    expect(
      summarizeScoreBody(item("a", "Daily Tens", "https://dailytens.com/"), entry("u", raw)),
    ).toBe(["🏆🏆🏆❌❌", "❌❌❌🏆❌"].join("\n"));
  });

  it("formats Tradle as a per-guess green-count sparkline with the `N/6` suffix", () => {
    const raw = [
      "#Tradle #1548 6/6",
      "🟩🟩⬜⬜⬜",
      "🟩🟩🟩⬜⬜",
      "🟩🟩🟩🟩🟨",
      "🟩🟩🟩🟩🟨",
      "🟩🟩🟩🟩🟨",
      "🟩🟩🟩🟩🟩",
      "https://tradle.net/",
    ].join("\n");
    expect(summarizeScoreBody(item("a", "Tradle", "https://tradle.net/"), entry("u", raw))).toBe(
      "🟩 2·3·4·4·4·5 6/6",
    );
  });

  it("formats a failed Tradle (`X/6`) sparkline", () => {
    const raw = [
      "#Tradle #1549 X/6",
      "🟩⬜⬜⬜⬜",
      "🟩🟩⬜⬜⬜",
      "🟩🟩🟨⬜⬜",
      "🟩🟩🟩⬜⬜",
      "🟩🟩🟩🟨⬜",
      "🟩🟩🟩🟩🟨",
      "https://tradle.net/",
    ].join("\n");
    expect(summarizeScoreBody(item("a", "Tradle", "https://tradle.net/"), entry("u", raw))).toBe(
      "🟩 1·2·2·3·3·4 X/6",
    );
  });

  it("formats GeoSports as `<emoji grid>\\n<score / max>`", () => {
    const raw =
      "GeoSports — Daily sports geography game\nGeoSports · June 11th\n🟡🟡🔴🟡🟢\n711 / 1,000\nwww.geosports.app";
    expect(
      summarizeScoreBody(item("a", "GeoSports", "https://www.geosports.app"), entry("u", raw)),
    ).toBe("🟡🟡🔴🟡🟢\n711 / 1,000");
  });

  it("formats NYT Mini as the `M:SS` solve time rendered as keycap-emoji digits", () => {
    const raw = "I solved the 5/20/2026 New York Times Mini Crossword in 0:16!";
    expect(
      summarizeScoreBody(
        item("a", "NYT Mini", "https://www.nytimes.com/crosswords/game/mini"),
        entry("u", raw),
      ),
    ).toBe("0️⃣:1️⃣6️⃣");
  });

  it("falls back to a cleaned raw copy for games without a heuristic, preserving alignment", () => {
    const raw = ["Some Game #123", "  ▓▓░░  ", "  ░░▓▓ https://example.com"].join("\n");
    expect(summarizeScoreBody(item("a", "Some Game"), entry("u", raw))).toBe(
      ["Some Game #123", "  ▓▓░░", "  ░░▓▓"].join("\n"),
    );
  });

  it("falls back to scoreValue when scoreRaw is null", () => {
    expect(summarizeScoreBody(item("a", "Wordle"), entry("u", null, 4))).toBe("4");
  });

  it("returns null when there's no usable signal", () => {
    expect(summarizeScoreBody(item("a", "Wordle"), entry("u", null, null))).toBeNull();
    expect(summarizeScoreBody(item("a", "Wordle"), entry("u", "   \n\n", null))).toBeNull();
  });

  it("returns null for a URL-only Daily Tens share instead of surfacing the URL ref id", () => {
    // The backend's "first number anywhere" parser pulls 944415 off the
    // `?ref=` URL param; we shouldn't echo that as the user's score.
    expect(
      summarizeScoreBody(
        item("a", "Daily Tens", "https://dailytens.com/"),
        entry("u", "https://dailytens.com/?ref=944415", 944415),
      ),
    ).toBeNull();
  });

  it("falls back to the bare `DailyTens #N` header (not scoreValue) when the grid is missing", () => {
    // Formatter rejects (no 🏆/❌); fallback surfaces the meaningful header
    // line over the URL-derived scoreValue.
    expect(
      summarizeScoreBody(
        item("a", "Daily Tens", "https://dailytens.com/"),
        entry("u", "DailyTens #751\nhttps://dailytens.com/?ref=944415", 944415),
      ),
    ).toBe("DailyTens #751");
  });

  it("strips hashtag-only and url-only lines in fallback", () => {
    const raw = "Some game #999\nactual score 42\nhttps://example.com\n#hashtag";
    expect(summarizeScoreBody(item("a", "Some Game"), entry("u", raw))).toBe(
      "Some game #999\nactual score 42",
    );
  });
});

describe("buildTodaysScoresSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 27, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null with no signed-in user", () => {
    expect(
      buildTodaysScoresSummary({
        listName: "Geo games",
        listUrl: LIST_URL,
        items: [item("a", "Wordle")],
        scoresByItem: { a: [entry("me", "4/6")] },
        selfId: null,
        dateKey: "2026-05-27",
      }),
    ).toBeNull();
  });

  it("returns null when the viewer hasn't posted any scores", () => {
    expect(
      buildTodaysScoresSummary({
        listName: "Geo games",
        listUrl: LIST_URL,
        items: [item("a", "Wordle")],
        scoresByItem: { a: [entry("friend", "5/6")] },
        selfId: "me",
        dateKey: "2026-05-27",
      }),
    ).toBeNull();
  });

  it("emits a tight per-game block in item order, prefixed by an absolute short date header", () => {
    const maptap = item("a", "maptap", "https://maptap.gg/");
    const globle = item("b", "Globle", "https://globle-game.com/game");
    const satle = item("c", "Satle", "https://satle.ca/");
    const travle = item("d", "travle", "https://travle.earth");

    const summary = buildTodaysScoresSummary({
      listName: "Geo games",
      listUrl: LIST_URL,
      items: [maptap, globle, satle, travle],
      scoresByItem: {
        a: [entry("me", "www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770")],
        b: [
          entry(
            "me",
            "🌎 May 27, 2026 🌍\n🔥 1 | Avg. Guesses: 8.4\n⬜🟨⬜🟧🟩 = 5\n\nhttps://globle-game.com\n#globle",
          ),
        ],
        c: [entry("me", "🛰Satle #468 6/6\n🟥🟥🟥🟥🟥🟩\nhttps://satle.ca")],
        d: [entry("me", "#travle #1260 +2\n🟧✅🟩🟧🟩✅✅\nhttps://travle.earth")],
      },
      selfId: "me",
      dateKey: "2026-05-27",
    });

    expect(summary).toBe(
      [
        "My scores in Geo games — May 27",
        "• maptap",
        "100🎯 95🏆 94🏅 52😔 77😂",
        "Final score: 770",
        "• Globle",
        "⬜🟨⬜🟧🟩 = 5",
        "• Satle",
        "🟥🟥🟥🟥🟥🟩 6/6",
        "• travle",
        "🟧✅🟩🟧🟩✅✅ +2",
        LIST_URL,
      ].join("\n"),
    );
  });

  it("uses an absolute short date for older days too (no `Yesterday` label)", () => {
    const summary = buildTodaysScoresSummary({
      listName: "Geo games",
      listUrl: LIST_URL,
      items: [item("a", "Globle", "https://globle-game.com/game")],
      scoresByItem: {
        a: [entry("me", "🌎 May 25, 2026 🌍\n⬜🟨🟩 = 3\nhttps://globle-game.com\n#globle")],
      },
      selfId: "me",
      dateKey: "2026-05-25",
    });
    expect(summary?.startsWith("My scores in Geo games — May 25\n")).toBe(true);
    expect(summary?.endsWith(`\n${LIST_URL}`)).toBe(true);
  });
});

describe("summarizeGameScoreBody with a taught summarySpec", () => {
  const SQUARDLE_RAW = "Squardle #512\nStreak: 14 🔥\n🟩🟩🟨⬜⬜\n🟩🟩🟩🟩🟩\n3/6";
  const taughtSummary = {
    rules: [{ kind: "matchLines" as const, pattern: "^[^A-Za-z]+$" }],
  };

  function taughtGame(): Game {
    return {
      ...game("g1", "Squardle", "https://squardle.example.com"),
      summarySpec: taughtSummary,
    };
  }

  it("renders only the lines the taught spec keeps", () => {
    expect(summarizeGameScoreBody(taughtGame(), entry("me", SQUARDLE_RAW))).toBe(
      "🟩🟩🟨⬜⬜\n🟩🟩🟩🟩🟩\n3/6",
    );
  });

  it("falls back to the cleaned full text when the spec matches nothing", () => {
    const raw = "Squardle changed its share format entirely";
    expect(summarizeGameScoreBody(taughtGame(), entry("me", raw))).toBe(raw);
  });

  it("never outranks a registry formatter when the raw text identifies a known game", () => {
    // MapTap has a hand-written registry formatter; the share text identifies
    // it regardless of which catalog row the score hangs off.
    const maptapRaw = "www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770";
    expect(summarizeGameScoreBody(taughtGame(), entry("me", maptapRaw))).toBe(
      "100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770",
    );
  });

  it("feeds the trimmed body into the clipboard recap", () => {
    const mg = myGame("g1", "Squardle", "https://squardle.example.com", [
      entry("me", SQUARDLE_RAW),
    ]);
    mg.game.summarySpec = taughtSummary;
    const summary = buildTodaysGameScoresSummary({
      friendUrl: FRIEND_URL,
      games: [mg],
      selfId: "me",
      dateKey: "2026-05-27",
    });
    expect(summary).toBe(
      ["My game scores — May 27", "• Squardle", "🟩🟩🟨⬜⬜", "🟩🟩🟩🟩🟩", "3/6", FRIEND_URL].join(
        "\n",
      ),
    );
  });
});

describe("buildTodaysGameScoresSummary", () => {
  it("returns null with no signed-in user", () => {
    expect(
      buildTodaysGameScoresSummary({
        friendUrl: FRIEND_URL,
        games: [
          myGame("a", "Wordle", "https://www.nytimes.com/games/wordle", [entry("me", "4/6")]),
        ],
        selfId: null,
        dateKey: "2026-05-27",
      }),
    ).toBeNull();
  });

  it("returns null when the viewer hasn't posted any game scores", () => {
    expect(
      buildTodaysGameScoresSummary({
        friendUrl: FRIEND_URL,
        games: [
          myGame("a", "Wordle", "https://www.nytimes.com/games/wordle", [entry("friend", "5/6")]),
        ],
        selfId: "me",
        dateKey: "2026-05-27",
      }),
    ).toBeNull();
  });

  it("copies the viewer's Games-tab scores with a friend invite link", () => {
    const summary = buildTodaysGameScoresSummary({
      friendUrl: FRIEND_URL,
      games: [
        myGame("a", "MapTap", "https://maptap.gg/", [
          entry("me", "www.maptap.gg May 27\n100🎯 95🏆 94🏅 52😔 77😂\nFinal score: 770"),
          entry("friend", "Final score: 700"),
        ]),
        myGame("b", "Globle", "https://globle-game.com", [
          entry(
            "me",
            "🌎 May 27, 2026 🌍\n🔥 1 | Avg. Guesses: 8.4\n⬜🟨⬜🟧🟩 = 5\nhttps://globle-game.com",
          ),
        ]),
      ],
      selfId: "me",
      dateKey: "2026-05-27",
    });

    expect(summary).toBe(
      [
        "My game scores — May 27",
        "• MapTap",
        "100🎯 95🏆 94🏅 52😔 77😂",
        "Final score: 770",
        "• Globle",
        "⬜🟨⬜🟧🟩 = 5",
        FRIEND_URL,
      ].join("\n"),
    );
  });
});
