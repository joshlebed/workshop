import type { Item, LeaderboardEntry } from "@workshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTodaysScoresSummary, summarizeScoreBody } from "./scoresSummary";

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
): LeaderboardEntry {
  return {
    userId,
    displayName: null,
    scoreRaw,
    scoreValue,
    updatedAt: "2026-05-22T12:00:00Z",
    rank: null,
  };
}

const LIST_URL = "https://workshop-a2v.pages.dev/list/list-1";

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

  it("formats Daily Tens by dropping the `DailyTens #N` header and keeping the aligned 🏆/❌ grid", () => {
    const raw = [
      "DailyTens #745",
      "",
      "      🏆    ❌",
      "      🏆    ❌",
      "      🏆    ❌",
      "      ❌    🏆",
      "      ❌    ❌ https://dailytens.com/?ref=954072",
    ].join("\n");
    expect(
      summarizeScoreBody(item("a", "Daily Tens", "https://dailytens.com/"), entry("u", raw)),
    ).toBe(
      [
        "      🏆    ❌",
        "      🏆    ❌",
        "      🏆    ❌",
        "      ❌    🏆",
        "      ❌    ❌",
      ].join("\n"),
    );
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
