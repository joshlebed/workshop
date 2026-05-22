import type { Item, LeaderboardEntry } from "@workshop/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTodaysScoresSummary, summarizeScoreLine } from "./scoresSummary";

function item(id: string, title: string): Item {
  return {
    id,
    listId: "list-1",
    kind: "plain",
    title,
    url: null,
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

describe("summarizeScoreLine", () => {
  it("prefers the server-parsed scoreValue when present", () => {
    expect(
      summarizeScoreLine({ scoreValue: 956, scoreRaw: "Final score: 956\nhttps://x.com" }),
    ).toBe("956");
  });

  it("falls back to the first meaningful line of raw text when scoreValue is null", () => {
    expect(summarizeScoreLine({ scoreValue: null, scoreRaw: "Wordle 1,422 4/6\n⬛⬛🟨⬛⬛" })).toBe(
      "Wordle 1,422 4/6",
    );
  });

  it("strips URLs before picking a line", () => {
    expect(
      summarizeScoreLine({
        scoreValue: null,
        scoreRaw: "https://globle-game.com\n#globle\n5 guesses",
      }),
    ).toBe("5 guesses");
  });

  it("skips lines that are pure emoji or whitespace", () => {
    expect(summarizeScoreLine({ scoreValue: null, scoreRaw: "🟪🟪🟪🟪\n\nDailyTens #742" })).toBe(
      "DailyTens #742",
    );
  });

  it("truncates absurdly long lines", () => {
    const long = "a".repeat(120);
    const result = summarizeScoreLine({ scoreValue: null, scoreRaw: long });
    expect(result?.endsWith("…")).toBe(true);
    expect(result?.length).toBeLessThanOrEqual(60);
  });

  it("returns null when no usable signal is available", () => {
    expect(summarizeScoreLine({ scoreValue: null, scoreRaw: null })).toBeNull();
    expect(summarizeScoreLine({ scoreValue: null, scoreRaw: "   \n\n" })).toBeNull();
    expect(summarizeScoreLine({ scoreValue: null, scoreRaw: "🟪🟪🟪" })).toBeNull();
  });
});

describe("buildTodaysScoresSummary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 22, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null with no signed-in user", () => {
    expect(
      buildTodaysScoresSummary({
        listName: "Daily Games",
        listUrl: LIST_URL,
        items: [item("a", "Wordle")],
        scoresByItem: { a: [entry("me", "4/6")] },
        selfId: null,
        dateKey: "2026-05-22",
      }),
    ).toBeNull();
  });

  it("returns null when the viewer hasn't posted any scores today", () => {
    expect(
      buildTodaysScoresSummary({
        listName: "Daily Games",
        listUrl: LIST_URL,
        items: [item("a", "Wordle"), item("b", "Connections")],
        scoresByItem: {
          a: [entry("friend", "5/6")],
          b: [entry("friend", "Solved")],
        },
        selfId: "me",
        dateKey: "2026-05-22",
      }),
    ).toBeNull();
  });

  it("emits one tight bullet per item, in item order, with a trailing list URL", () => {
    const summary = buildTodaysScoresSummary({
      listName: "Daily Games",
      listUrl: LIST_URL,
      items: [item("a", "Wordle"), item("b", "Connections"), item("c", "Strands")],
      scoresByItem: {
        a: [
          entry("friend", "5/6"),
          entry("me", "Wordle 1,422 4/6\n⬛⬛🟨⬛⬛\nhttps://www.nytimes.com/games/wordle"),
        ],
        b: [entry("me", null, 7)],
        c: [entry("friend", "Strands #1\n🔵🔵🔵🟡")],
      },
      selfId: "me",
      dateKey: "2026-05-22",
    });
    expect(summary).toBe(
      [
        "Daily Games — Today",
        "",
        "• Wordle: Wordle 1,422 4/6",
        "• Connections: 7",
        "",
        LIST_URL,
      ].join("\n"),
    );
  });

  it("uses the date-key label in the header for older days", () => {
    const summary = buildTodaysScoresSummary({
      listName: "Daily Games",
      listUrl: LIST_URL,
      items: [item("a", "Wordle")],
      scoresByItem: { a: [entry("me", null, 4)] },
      selfId: "me",
      dateKey: "2026-05-21",
    });
    expect(summary?.startsWith("Daily Games — Yesterday\n\n")).toBe(true);
    expect(summary?.endsWith(`\n\n${LIST_URL}`)).toBe(true);
  });
});
